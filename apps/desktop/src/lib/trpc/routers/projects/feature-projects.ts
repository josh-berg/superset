import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	githubRepoCache,
	projects,
	settings,
	workspaceSections,
	workspaces,
	worktrees,
} from "@superset/local-db";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { track } from "main/lib/analytics";
import { localDb } from "main/lib/local-db";
import { deleteProjectIcon } from "main/lib/project-icons";
import { getWorkspaceRuntimeRegistry } from "main/lib/workspace-runtime";
import { PROJECT_COLOR_VALUES } from "shared/constants/project-colors";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import {
	selectNextActiveWorkspace,
	setLastActiveWorkspace,
} from "../workspaces/utils/db-helpers";
import { getDefaultBranch } from "../workspaces/utils/git";
import { getSimpleGitWithShellPath } from "../workspaces/utils/git-client";
import { execWithShellEnv } from "../workspaces/utils/shell-env";
import { getDefaultProjectColor } from "./utils/colors";
import { regenerateMultiRepoContext } from "./utils/multi-repo-context-sync";
import {
	ensureChildRepoWorkspace,
	ensureGitlessWorkspace,
} from "./utils/workspace-bootstrap";

const SAFE_REPO_NAME_REGEX = /^[a-zA-Z0-9._\- ]+$/;

// Cached in-process so we only pay the gh API cost once per app session.
let cachedOwners: string[] | null = null;

async function resolveGitHubOwners(): Promise<string[]> {
	if (cachedOwners) return cachedOwners;

	const [userResult, orgsResult] = await Promise.allSettled([
		execWithShellEnv("gh", ["api", "user", "--jq", ".login"], {
			timeout: 5_000,
		}),
		execWithShellEnv("gh", ["api", "user/orgs", "--jq", ".[].login"], {
			timeout: 5_000,
		}),
	]);

	const owners: string[] = [];
	if (userResult.status === "fulfilled") {
		const login = userResult.value.stdout.trim();
		if (login) owners.push(login);
	}
	if (orgsResult.status === "fulfilled") {
		for (const org of orgsResult.value.stdout.trim().split("\n")) {
			if (org) owners.push(org);
		}
	}

	if (owners.length > 0) cachedOwners = owners;
	return owners;
}

function sanitizeRepoName(name: string): string | null {
	const clean = name.trim().replace(/\.git$/, "");
	return SAFE_REPO_NAME_REGEX.test(clean) && !/^\.+$/.test(clean)
		? clean
		: null;
}

/** Convert a human-readable project name to a safe folder name with no spaces or special characters. */
function sanitizeProjectFolderName(name: string): string {
	const clean = name
		.trim()
		.replace(/[\s]+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "");
	return clean || "project";
}

export const createFeatureProjectsRouter = () => {
	return router({
		/** Create a new feature project (parent folder + gitless workspace). */
		create: publicProcedure
			.input(
				z.object({
					name: z.string().min(1).max(100),
					parentDir: z.string().min(1),
					color: z
						.string()
						.refine((v) => PROJECT_COLOR_VALUES.includes(v), "Invalid color")
						.optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const projectPath = join(
					input.parentDir,
					sanitizeProjectFolderName(input.name),
				);

				await mkdir(projectPath, { recursive: true });

				const existing = localDb
					.select()
					.from(projects)
					.where(eq(projects.mainRepoPath, projectPath))
					.get();

				if (existing) {
					const workspaceId = ensureGitlessWorkspace(existing);
					return { project: existing, workspaceId };
				}

				const project = localDb
					.insert(projects)
					.values({
						mainRepoPath: projectPath,
						name: input.name.trim(),
						color: input.color ?? getDefaultProjectColor(),
						isGitless: true,
						isFeatureProject: true,
					})
					.returning()
					.get();

				const workspaceId = ensureGitlessWorkspace(project);

				track("feature_project_created", { project_id: project.id });

				return { project, workspaceId };
			}),

		/** Search GitHub repos accessible to the authenticated gh CLI user. */
		searchGitHubRepos: publicProcedure
			.input(
				z.object({
					query: z.string().min(1),
					limit: z.number().min(1).max(50).default(20),
				}),
			)
			.query(async ({ input }) => {
				try {
					const owners = await resolveGitHubOwners();
					if (owners.length === 0) return [];

					const ownerFlags = owners.flatMap((o) => ["--owner", o]);

					const { stdout } = await execWithShellEnv(
						"gh",
						[
							"search",
							"repos",
							input.query,
							...ownerFlags,
							"--archived=false",
							"--json",
							"fullName,description,isPrivate,url,name",
							"--limit",
							String(input.limit),
						],
						{ timeout: 10_000 },
					);
					const raw: unknown = JSON.parse(stdout.trim() || "[]");
					if (!Array.isArray(raw)) return [];

					return raw
						.filter(
							(item): item is Record<string, unknown> =>
								typeof item === "object" && item !== null,
						)
						.map((item) => ({
							fullName: String(item.fullName ?? ""),
							name: String(item.name ?? ""),
							description: item.description ? String(item.description) : null,
							isPrivate: Boolean(item.isPrivate),
							url: String(item.url ?? ""),
						}))
						.filter((item) => item.fullName);
				} catch (err) {
					console.warn("[searchGitHubRepos] Failed:", err);
					return [];
				}
			}),

		/**
		 * Return the current state of the local GitHub repo cache:
		 * how many repos are stored and when they were last synced.
		 */
		getRepoCacheStatus: publicProcedure.query(() => {
			const row = localDb
				.select({
					count: sql<number>`count(*)`,
					syncedAt: sql<number | null>`max(${githubRepoCache.syncedAt})`,
				})
				.from(githubRepoCache)
				.get();
			return {
				count: row?.count ?? 0,
				syncedAt: row?.syncedAt ?? null,
			};
		}),

		/**
		 * Fetch every repo accessible to the authenticated gh CLI user and store it
		 * in the local cache.  Uses `user/repos?affiliation=...` with pagination so
		 * we get owned repos, org repos, and collaborator repos in one pass.
		 */
		syncRepoCache: publicProcedure.mutation(async () => {
			try {
				const { stdout } = await execWithShellEnv(
					"gh",
					[
						"api",
						"user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
						"--paginate",
						"--jq",
						".[] | {fullName: .full_name, name: .name, description: .description, isPrivate: .private, url: .html_url}",
					],
					{ timeout: 120_000 },
				);

				// --paginate + streaming jq produces one JSON object per line (NDJSON)
				const rows = stdout
					.trim()
					.split("\n")
					.filter(Boolean)
					.flatMap((line) => {
						try {
							const item = JSON.parse(line) as Record<string, unknown>;
							const fullName = String(item.fullName ?? "");
							if (!fullName) return [];
							return [
								{
									fullName,
									name: String(item.name ?? ""),
									description: item.description
										? String(item.description)
										: null,
									isPrivate: Boolean(item.isPrivate),
									url: String(item.url ?? ""),
									syncedAt: Date.now(),
								},
							];
						} catch {
							return [];
						}
					});

				if (rows.length === 0) return { count: 0 };

				// Wipe old cache and replace atomically
				localDb.delete(githubRepoCache).run();
				// Insert in batches of 500 to stay well within SQLite's variable limit
				const BATCH = 500;
				for (let i = 0; i < rows.length; i += BATCH) {
					localDb
						.insert(githubRepoCache)
						.values(rows.slice(i, i + BATCH))
						.run();
				}

				return { count: rows.length };
			} catch (err) {
				console.warn("[syncRepoCache] Failed:", err);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						err instanceof Error ? err.message : "Failed to sync repo cache",
				});
			}
		}),

		/**
		 * Search the local GitHub repo cache.  Falls back to an empty result when the
		 * cache has not been populated yet (callers should prompt the user to sync).
		 *
		 * Matching is name/fullName only (not description) so description-only repos
		 * never appear above repos whose actual name contains the query.
		 *
		 * Results are ranked by two dimensions:
		 *
		 * Primary – org/name family (most-used repos surface first):
		 *   0 – hudl/hudl-*  (the repos most frequently selected)
		 *   1 – everything else
		 *
		 * Secondary – match quality within each family:
		 *   0 – short name starts with query  (e.g. "ticketing" → "ticketing-service")
		 *   1 – short name contains query     (e.g. "ticketing" → "hudl-ticketing")
		 *   2 – only the org prefix matches   (e.g. "ticketing" → "ticketing-org/other")
		 *
		 * Tertiary – alphabetical by fullName.
		 */
		searchCachedRepos: publicProcedure
			.input(
				z.object({
					query: z.string(),
					limit: z.number().min(1).max(100).default(20),
				}),
			)
			.query(({ input }) => {
				const q = input.query.trim();
				if (!q) {
					return localDb
						.select()
						.from(githubRepoCache)
						.orderBy(githubRepoCache.fullName)
						.limit(input.limit)
						.all();
				}
				const contains = `%${q}%`;
				const startsWith = `${q}%`;
				return localDb
					.select()
					.from(githubRepoCache)
					.where(
						or(
							like(githubRepoCache.fullName, contains),
							like(githubRepoCache.name, contains),
						),
					)
					.orderBy(
						sql<number>`CASE
							WHEN ${githubRepoCache.fullName} LIKE ${"hudl/hudl-%"} THEN 0
							ELSE 1
						END`,
						sql<number>`CASE
							WHEN ${githubRepoCache.name} LIKE ${startsWith} THEN 0
							WHEN ${githubRepoCache.name} LIKE ${contains}   THEN 1
							ELSE 2
						END`,
						githubRepoCache.fullName,
					)
					.limit(input.limit)
					.all();
			}),

		/** Check which repo names already have a local clone in <projectsRootDir>/repos/. */
		getLocalCloneAvailability: publicProcedure
			.input(z.object({ repoNames: z.array(z.string()) }))
			.query(({ input }) => {
				const currentSettings = localDb.select().from(settings).get();
				const projectsRootDir = currentSettings?.projectsRootDir;
				if (!projectsRootDir) return {} as Record<string, boolean>;
				return Object.fromEntries(
					input.repoNames.map((name) => [
						name,
						existsSync(join(projectsRootDir, "repos", name, ".git")),
					]),
				) as Record<string, boolean>;
			}),

		/** Clone a GitHub repo into the feature project folder and create a child project. */
		addRepo: publicProcedure
			.input(
				z.object({
					featureProjectId: z.string(),
					repoFullName: z.string().min(1),
					branchName: z.string().min(1).optional(),
					parentBranch: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const featureProject = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.featureProjectId))
					.get();

				if (!featureProject?.isFeatureProject) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Feature project not found",
					});
				}

				const repoName = sanitizeRepoName(basename(input.repoFullName));
				if (!repoName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid repository name",
					});
				}

				const clonePath = join(featureProject.mainRepoPath, repoName);

				// Idempotency: if this repo was already successfully cloned in a prior
				// attempt, skip cloning and return the existing record.
				const existingChild = localDb
					.select()
					.from(projects)
					.where(
						and(
							eq(projects.mainRepoPath, clonePath),
							eq(projects.parentProjectId, input.featureProjectId),
						),
					)
					.get();

				if (existingChild && existsSync(clonePath)) {
					const existingWorkspace = localDb
						.select()
						.from(workspaces)
						.where(eq(workspaces.projectId, existingChild.id))
						.get();
					const workspaceId =
						existingWorkspace?.id ??
						ensureChildRepoWorkspace(
							existingChild,
							existingChild.defaultBranch ?? "main",
						);
					return { project: existingChild, workspaceId };
				}

				// Clone the repository — prefer a fast local clone if the repo already
				// exists in <projectsRootDir>/repos/, otherwise fall back to gh.
				const currentSettings = localDb.select().from(settings).get();
				const projectsRootDir = currentSettings?.projectsRootDir;
				const localRepoPath = projectsRootDir
					? join(projectsRootDir, "repos", repoName)
					: null;
				const useLocalClone =
					localRepoPath !== null && existsSync(join(localRepoPath, ".git"));

				try {
					if (useLocalClone && localRepoPath) {
						// Local clone shares git objects via hardlinks — much faster for large repos
						await execWithShellEnv(
							"git",
							["clone", "--local", localRepoPath, clonePath],
							{ timeout: 30_000 },
						);
						// Fix remote so it points to GitHub, not the local source
						await execWithShellEnv(
							"git",
							[
								"-C",
								clonePath,
								"remote",
								"set-url",
								"origin",
								`https://github.com/${input.repoFullName}.git`,
							],
							{ timeout: 5_000 },
						);
						// Fetch latest from GitHub — non-fatal: some repos have branches that
						// differ only by case and fail on macOS's case-insensitive filesystem.
						try {
							await execWithShellEnv(
								"git",
								["-C", clonePath, "fetch", "origin"],
								{ timeout: 60_000 },
							);
						} catch {
							// Clone is still usable; local state from source repo is sufficient
						}
					} else {
						await execWithShellEnv(
							"gh",
							["repo", "clone", input.repoFullName, clonePath],
							{ timeout: 120_000 },
						);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: `Failed to clone ${input.repoFullName}: ${msg}`,
					});
				}

				const defaultBranch =
					input.parentBranch ?? (await getDefaultBranch(clonePath));

				// For local clones, ensure the default branch is checked out and up to date
				// with GitHub (the local source may have been behind or diverged).
				if (useLocalClone) {
					const syncGit = await getSimpleGitWithShellPath(clonePath);
					try {
						await syncGit.checkout(defaultBranch);
						await syncGit.pull("origin", defaultBranch, ["--ff-only"]);
					} catch {
						// Non-fatal: the clone is still usable even if the pull fails
					}
				}

				// Create or checkout the feature branch (only when a branch name was supplied)
				if (input.branchName) {
					const git = await getSimpleGitWithShellPath(clonePath);
					try {
						await git.checkoutLocalBranch(input.branchName);
					} catch {
						// Branch may already exist locally or remotely
						try {
							await git.checkout(input.branchName);
						} catch {
							// If checkout fails, create from parent branch
							await git.checkoutBranch(input.branchName, defaultBranch);
						}
					}
				}

				const resolvedBranch = input.branchName ?? defaultBranch;

				// Create the child project record (tabOrder=null keeps it hidden from main sidebar)
				const childProject = localDb
					.insert(projects)
					.values({
						mainRepoPath: clonePath,
						name: repoName,
						color: featureProject.color,
						defaultBranch,
						parentProjectId: input.featureProjectId,
						isGitless: false,
						isFeatureProject: false,
					})
					.returning()
					.get();

				const workspaceId = ensureChildRepoWorkspace(
					childProject,
					resolvedBranch,
				);

				try {
					await regenerateMultiRepoContext(input.featureProjectId);
				} catch (err) {
					console.warn("[addRepo] Failed to sync multi-repo context:", err);
				}

				track("feature_project_repo_added", {
					feature_project_id: input.featureProjectId,
					child_project_id: childProject.id,
				});

				return { project: childProject, workspaceId };
			}),

		/** Get all child repo projects for a feature project. */
		getChildRepos: publicProcedure
			.input(z.object({ featureProjectId: z.string() }))
			.query(({ input }) => {
				const children = localDb
					.select()
					.from(projects)
					.where(eq(projects.parentProjectId, input.featureProjectId))
					.all();

				if (children.length === 0) return [];

				const childWorkspaces = localDb
					.select()
					.from(workspaces)
					.where(
						and(
							inArray(
								workspaces.projectId,
								children.map((c) => c.id),
							),
							eq(workspaces.type, "branch"),
							isNull(workspaces.deletingAt),
						),
					)
					.all();

				const workspaceByProjectId = new Map(
					childWorkspaces.map((ws) => [ws.projectId, ws]),
				);

				return children.map((child) => {
					const ws = workspaceByProjectId.get(child.id);
					return {
						id: child.id,
						name: child.name,
						mainRepoPath: child.mainRepoPath,
						defaultBranch: child.defaultBranch,
						workspaceId: ws?.id ?? null,
						workspaceBranch: ws?.branch ?? "",
					};
				});
			}),

		/**
		 * Manually regenerate the auto-injected multi-repo context files for a
		 * feature project (or a child repo within one). Normally unnecessary
		 * since `addRepo`/`removeRepo` keep these files in sync automatically;
		 * exposed for recovery if a file was deleted or edited by hand.
		 */
		syncMultiRepoContext: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();
				if (!project) return { applicable: false as const };

				const featureProjectId = project.isFeatureProject
					? project.id
					: project.parentProjectId;
				if (!featureProjectId) return { applicable: false as const };

				return regenerateMultiRepoContext(featureProjectId);
			}),

		/** Remove a child repo from a feature project. Optionally deletes the folder from disk. */
		removeRepo: publicProcedure
			.input(
				z.object({
					childProjectId: z.string(),
					deleteFromDisk: z.boolean().default(false),
				}),
			)
			.mutation(async ({ input }) => {
				const child = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.childProjectId))
					.get();

				if (!child || !child.parentProjectId) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "Child repo project not found",
					});
				}

				const childWorkspaces = localDb
					.select()
					.from(workspaces)
					.where(eq(workspaces.projectId, child.id))
					.all();

				const registry = getWorkspaceRuntimeRegistry();
				for (const ws of childWorkspaces) {
					const terminal = registry.getForWorkspaceId(ws.id).terminal;
					await terminal.killByWorkspaceId(ws.id);
				}

				const childWorkspaceIds = childWorkspaces.map((w) => w.id);
				if (childWorkspaceIds.length > 0) {
					// Update active workspace if needed
					const currentSettings = localDb.select().from(settings).get();
					if (
						currentSettings?.lastActiveWorkspaceId &&
						childWorkspaceIds.includes(currentSettings.lastActiveWorkspaceId)
					) {
						setLastActiveWorkspace(selectNextActiveWorkspace());
					}

					localDb
						.delete(workspaces)
						.where(inArray(workspaces.id, childWorkspaceIds))
						.run();
				}

				localDb
					.delete(worktrees)
					.where(eq(worktrees.projectId, child.id))
					.run();
				localDb
					.delete(workspaceSections)
					.where(eq(workspaceSections.projectId, child.id))
					.run();
				deleteProjectIcon(child.id);
				localDb.delete(projects).where(eq(projects.id, child.id)).run();

				if (input.deleteFromDisk) {
					const { rm } = await import("node:fs/promises");
					await rm(child.mainRepoPath, { recursive: true, force: true });
				}

				try {
					await regenerateMultiRepoContext(child.parentProjectId);
				} catch (err) {
					console.warn("[removeRepo] Failed to sync multi-repo context:", err);
				}

				return { success: true };
			}),
	});
};

export type FeatureProjectsRouter = ReturnType<
	typeof createFeatureProjectsRouter
>;
