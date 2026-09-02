import { existsSync, statSync } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import {
	BRANCH_PREFIX_MODES,
	EXTERNAL_APPS,
	projects,
	type SelectProject,
	settings,
	workspaceSections,
	workspaces,
	worktrees,
} from "@superset/local-db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, isNull, not } from "drizzle-orm";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { track } from "main/lib/analytics";
import { localDb } from "main/lib/local-db";
import {
	deleteProjectIcon,
	saveProjectIconFromDataUrl,
} from "main/lib/project-icons";
import { getWorkspaceRuntimeRegistry } from "main/lib/workspace-runtime";
import { PROJECT_COLOR_VALUES } from "shared/constants/project-colors";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { resolveDefaultEditor } from "../external";
import {
	activateProject,
	getBranchWorkspace,
	selectNextActiveWorkspace,
	setLastActiveWorkspace,
	touchWorkspace,
} from "../workspaces/utils/db-helpers";
import {
	getCurrentBranch,
	getDefaultBranch,
	getGitAuthorName,
	getGitRoot,
	hasUncommittedChanges,
	hasUnpushedCommits,
	NotGitRepoError,
	refreshDefaultBranch,
	sanitizeAuthorPrefix,
} from "../workspaces/utils/git";
import { getSimpleGitWithShellPath } from "../workspaces/utils/git-client";
import { execWithShellEnv } from "../workspaces/utils/shell-env";
import { getAutoProjectAbbreviation } from "./utils/abbreviations/abbreviations";
import { getAutoProjectColor } from "./utils/colors";
import { discoverAndSaveProjectIcon } from "./utils/favicon-discovery";
import { ensureGitlessWorkspace } from "./utils/workspace-bootstrap";

type Project = SelectProject;

type OpenNewCanceled = { canceled: true };
type OpenNewError = { canceled: false; error: string };
type OpenNewResult =
	| OpenNewCanceled
	| { canceled: false; project: Project }
	| { canceled: false; needsGitInit: true; selectedPath: string }
	| OpenNewError;

/**
 * Parses and transforms raw GitHub PR data from CLI output.
 * Filters valid PR objects and maps them to our internal format.
 */
function isRawPullRequest(item: unknown): item is {
	number: number;
	title: string;
	url: string;
	state: string;
	isDraft: boolean;
} {
	if (typeof item !== "object" || item === null) return false;

	const value = item as Record<string, unknown>;
	return (
		typeof value.number === "number" &&
		typeof value.title === "string" &&
		typeof value.url === "string" &&
		typeof value.state === "string" &&
		typeof value.isDraft === "boolean"
	);
}

function parsePullRequests(raw: unknown) {
	if (!Array.isArray(raw)) return [];

	return raw.filter(isRawPullRequest).map((pr) => ({
		prNumber: pr.number,
		title: pr.title,
		url: pr.url,
		state: pr.isDraft
			? "draft"
			: pr.state === "OPEN"
				? "open"
				: pr.state.toLowerCase(),
	}));
}

type FolderOutcome =
	| { status: "success"; project: Project }
	| { status: "needsGitInit"; selectedPath: string }
	| { status: "error"; selectedPath: string; error: string };

type OpenNewMultiResult =
	| OpenNewCanceled
	| { canceled: false; multi: true; results: FolderOutcome[] }
	| OpenNewError;

async function initGitRepo(path: string): Promise<{ defaultBranch: string }> {
	const git = await getSimpleGitWithShellPath(path);

	try {
		await git.init(["--initial-branch=main"]);
	} catch (err) {
		console.warn("Git init with --initial-branch failed, using fallback:", err);
		await git.init();
	}

	try {
		await git.raw(["commit", "--allow-empty", "-m", "Initial commit"]);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		if (
			errorMessage.includes("empty ident") ||
			errorMessage.includes("user.email") ||
			errorMessage.includes("user.name")
		) {
			throw new Error(
				"Git user not configured. Please run:\n" +
					'  git config --global user.name "Your Name"\n' +
					'  git config --global user.email "you@example.com"',
			);
		}
		throw new Error(`Failed to create initial commit: ${errorMessage}`);
	}

	const defaultBranch = (await getCurrentBranch(path)) || "main";
	return { defaultBranch };
}

function getExistingProjectColors(): string[] {
	return localDb
		.select({ color: projects.color })
		.from(projects)
		.all()
		.map((p) => p.color);
}

/** Insert or update a project record in the local database, returning the persisted row. */
function upsertProject(mainRepoPath: string, defaultBranch: string): Project {
	const name = basename(mainRepoPath);

	const existing = localDb
		.select()
		.from(projects)
		.where(eq(projects.mainRepoPath, mainRepoPath))
		.get();

	if (existing) {
		localDb
			.update(projects)
			.set({ lastOpenedAt: Date.now(), defaultBranch })
			.where(eq(projects.id, existing.id))
			.run();
		return { ...existing, lastOpenedAt: Date.now(), defaultBranch };
	}

	const color = getAutoProjectColor(getExistingProjectColors());
	const iconLetter = getAutoProjectAbbreviation(name);
	const project = localDb
		.insert(projects)
		.values({
			mainRepoPath,
			name,
			color,
			iconLetter,
			defaultBranch,
		})
		.returning()
		.get();

	return project;
}

async function ensureMainWorkspace(project: Project): Promise<void> {
	const existingBranchWorkspace = getBranchWorkspace(project.id);

	if (existingBranchWorkspace) {
		touchWorkspace(existingBranchWorkspace.id);
		setLastActiveWorkspace(existingBranchWorkspace.id);
		return;
	}

	const branch = await getCurrentBranch(project.mainRepoPath);
	if (!branch) {
		console.warn(
			`[ensureMainWorkspace] Could not determine current branch for project ${project.id}`,
		);
		return;
	}

	// Unique partial index (projectId WHERE type='branch') prevents duplicates
	const insertResult = localDb
		.insert(workspaces)
		.values({
			projectId: project.id,
			type: "branch",
			branch,
			name: "default",
			tabOrder: 0,
		})
		.onConflictDoNothing()
		.returning()
		.all();

	const wasExisting = insertResult.length === 0;

	if (!wasExisting) {
		const newWorkspaceId = insertResult[0].id;
		const projectWorkspaces = localDb
			.select()
			.from(workspaces)
			.where(
				and(
					eq(workspaces.projectId, project.id),
					not(eq(workspaces.id, newWorkspaceId)),
					isNull(workspaces.deletingAt),
				),
			)
			.all();

		for (const ws of projectWorkspaces) {
			localDb
				.update(workspaces)
				.set({ tabOrder: ws.tabOrder + 1 })
				.where(eq(workspaces.id, ws.id))
				.run();
		}
	}

	const workspace = insertResult[0] ?? getBranchWorkspace(project.id);

	if (!workspace) {
		console.warn(
			`[ensureMainWorkspace] Failed to create or find branch workspace for project ${project.id}`,
		);
		return;
	}

	setLastActiveWorkspace(workspace.id);

	if (!wasExisting) {
		activateProject(project);

		track("workspace_opened", {
			workspace_id: workspace.id,
			project_id: project.id,
			type: "branch",
			was_existing: false,
			auto_created: true,
		});
	}
}

// Callers must additionally reject dot-only names (".", "..") to prevent path traversal
const SAFE_REPO_NAME_REGEX = /^[a-zA-Z0-9._\- ]+$/;
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:"]);
const SSH_GIT_URL_REGEX = /^[\w.-]+@[\w.-]+:[\w./-]+$/;
const BRANCH_SEARCH_LIMIT = 5000;

/** Extract the repository name from a git URL (HTTPS, SSH, or git:// protocol). */
function extractRepoName(urlInput: string): string | null {
	let normalized = urlInput.trim().replace(/\/+$/, "");

	if (!normalized) return null;

	let repoSegment: string | undefined;

	try {
		const parsed = new URL(normalized);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			const pathname = parsed.pathname;
			repoSegment = pathname.split("/").filter(Boolean).pop();
		}
	} catch {
		// Not a standard URL — fall through to SSH-style parsing
	}

	if (!repoSegment) {
		const colonIndex = normalized.indexOf(":");
		if (colonIndex !== -1 && !normalized.includes("://")) {
			normalized = normalized.slice(colonIndex + 1);
		}
		repoSegment = normalized.split("/").filter(Boolean).pop();
	}

	if (!repoSegment) return null;

	repoSegment = repoSegment.split("?")[0].split("#")[0];
	repoSegment = repoSegment.replace(/\.git$/, "");

	try {
		repoSegment = decodeURIComponent(repoSegment);
	} catch {}

	repoSegment = repoSegment.trim();

	if (!repoSegment || !SAFE_REPO_NAME_REGEX.test(repoSegment)) {
		return null;
	}

	return repoSegment;
}

/** Returns a map of branch name → where it's checked out ("main" | "worktree"). */
async function getCheckedOutBranches(
	repoPath: string,
): Promise<Map<string, "main" | "worktree">> {
	const checkedOut = new Map<string, "main" | "worktree">();
	try {
		const git = await getSimpleGitWithShellPath(repoPath);
		const output = await git.raw(["worktree", "list", "--porcelain"]);
		// Each worktree block is separated by a blank line; the first block is the main worktree.
		const blocks = output.split(/\n\n+/);
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[i];
			const branchLine = block.split("\n").find((l) => l.startsWith("branch "));
			if (!branchLine) continue;
			const ref = branchLine.slice("branch ".length).trim();
			const name = ref.startsWith("refs/heads/")
				? ref.slice("refs/heads/".length)
				: ref;
			if (name) checkedOut.set(name, i === 0 ? "main" : "worktree");
		}
	} catch {
		// Best effort
	}
	return checkedOut;
}

/** Create the tRPC router for project CRUD, branch listing, and git operations. */
export const createProjectsRouter = (getWindow: () => BrowserWindow | null) => {
	return router({
		get: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }): Project => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Project ${input.id} not found`,
					});
				}

				return project;
			}),

		getDefaultApp: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => {
				return resolveDefaultEditor(input.projectId);
			}),

		getRecents: publicProcedure.query((): Project[] => {
			return localDb
				.select()
				.from(projects)
				.where(isNotNull(projects.tabOrder))
				.orderBy(desc(projects.lastOpenedAt))
				.all();
		}),

		listPullRequests: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();
				if (!project) return [];

				try {
					const { stdout } = await execWithShellEnv(
						"gh",
						[
							"pr",
							"list",
							"--state",
							"open",
							"--limit",
							"30",
							"--json",
							"number,title,url,state,isDraft",
						],
						{ cwd: project.mainRepoPath },
					);
					const raw: unknown = JSON.parse(stdout.trim() || "[]");
					return parsePullRequests(raw);
				} catch (err) {
					console.warn("[listPullRequests] Failed to list PRs:", err);
					return [];
				}
			}),

		searchPullRequests: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					query: z.string(),
				}),
			)
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();
				if (!project) return [];

				try {
					const { stdout } = await execWithShellEnv(
						"gh",
						[
							"pr",
							"list",
							"--state",
							"all",
							"--search",
							input.query,
							"--limit",
							"100",
							"--json",
							"number,title,url,state,isDraft",
						],
						{ cwd: project.mainRepoPath, timeout: 10_000 },
					);
					const raw: unknown = JSON.parse(stdout.trim() || "[]");
					return parsePullRequests(raw);
				} catch (err) {
					console.warn("[searchPullRequests] Failed to search PRs:", err);
					return [];
				}
			}),

		listIssues: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();
				if (!project) return [];

				try {
					const { stdout } = await execWithShellEnv(
						"gh",
						[
							"issue",
							"list",
							"--state",
							"open",
							"--limit",
							"30",
							"--json",
							"number,title,url,state,labels",
						],
						{ cwd: project.mainRepoPath, timeout: 10000 },
					);
					const raw: unknown = JSON.parse(stdout.trim() || "[]");

					// Runtime validation with zod schema
					const IssueListItemSchema = z.object({
						number: z.number(),
						title: z.string(),
						url: z.string(),
						state: z.string(),
						labels: z.array(z.unknown()).optional(),
					});

					const issuesArray = z.array(IssueListItemSchema).safeParse(raw);
					if (!issuesArray.success) {
						console.warn(
							"[listIssues] Invalid response format:",
							issuesArray.error,
						);
						return [];
					}

					return issuesArray.data.map((issue) => ({
						issueNumber: issue.number,
						title: issue.title,
						url: issue.url,
						state: issue.state === "OPEN" ? "open" : issue.state.toLowerCase(),
					}));
				} catch (err) {
					console.warn("[listIssues] Failed to list issues:", err);
					return [];
				}
			}),

		getIssueContent: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					issueNumber: z.number().int().positive(),
				}),
			)
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();
				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Project ${input.projectId} not found`,
					});
				}

				try {
					const { stdout } = await execWithShellEnv(
						"gh",
						[
							"issue",
							"view",
							String(input.issueNumber),
							"--json",
							"number,title,body,url,state,author,createdAt,updatedAt",
						],
						{ cwd: project.mainRepoPath, timeout: 10000 },
					);
					const raw: unknown = JSON.parse(stdout.trim() || "{}");

					// Runtime validation with zod schema
					const IssueSchema = z.object({
						number: z.number(),
						title: z.string(),
						body: z.string(),
						url: z.string(),
						state: z.string(),
						author: z.object({ login: z.string() }).optional(),
						createdAt: z.string().optional(),
						updatedAt: z.string().optional(),
					});

					const issue = IssueSchema.parse(raw);

					return {
						number: issue.number,
						title: issue.title,
						body: issue.body || "",
						url: issue.url,
						state: issue.state === "OPEN" ? "open" : issue.state.toLowerCase(),
						author: issue.author?.login,
						createdAt: issue.createdAt,
						updatedAt: issue.updatedAt,
					};
				} catch (err) {
					console.warn(
						`[getIssueContent] Failed to fetch issue #${input.issueNumber}:`,
						err,
					);
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: `Failed to fetch issue #${input.issueNumber}: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
			}),

		selectDirectory: publicProcedure
			.input(
				z.object({
					defaultPath: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const window = getWindow();
				if (!window) {
					return { canceled: true as const, path: null };
				}
				const result = await dialog.showOpenDialog(window, {
					properties: ["openDirectory", "createDirectory"],
					title: "Select Directory",
					defaultPath: input.defaultPath,
				});
				if (result.canceled || result.filePaths.length === 0) {
					return { canceled: true as const, path: null };
				}
				return { canceled: false as const, path: result.filePaths[0] };
			}),

		// Fast: returns only local branches + cached remote refs (no network)
		getBranchesLocal: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(
				async ({
					input,
				}): Promise<{
					branches: Array<{
						name: string;
						lastCommitDate: number;
						isLocal: boolean;
						isRemote: boolean;
						checkedOutIn: "main" | "worktree" | null;
					}>;
					defaultBranch: string;
				}> => {
					const project = localDb
						.select()
						.from(projects)
						.where(eq(projects.id, input.projectId))
						.get();
					if (!project) {
						throw new Error(`Project ${input.projectId} not found`);
					}

					const git = await getSimpleGitWithShellPath(project.mainRepoPath);

					// No fetch — use only locally available refs
					const branchSummary = await git.branch(["-a"]);

					const localBranchSet = new Set<string>();
					const remoteBranchSet = new Set<string>();

					for (const name of Object.keys(branchSummary.branches)) {
						if (name.startsWith("remotes/origin/")) {
							if (name === "remotes/origin/HEAD") continue;
							const remoteName = name.replace("remotes/origin/", "");
							remoteBranchSet.add(remoteName);
						} else {
							localBranchSet.add(name);
						}
					}

					const branchMap = new Map<
						string,
						{ lastCommitDate: number; isLocal: boolean; isRemote: boolean }
					>();

					// Include cached remote refs (no network needed)
					if (remoteBranchSet.size > 0) {
						try {
							const remoteBranchInfo = await git.raw([
								"for-each-ref",
								"--sort=-committerdate",
								"--format=%(refname:short) %(committerdate:unix)",
								"refs/remotes/origin/",
							]);

							for (const line of remoteBranchInfo.trim().split("\n")) {
								if (!line) continue;
								const lastSpaceIdx = line.lastIndexOf(" ");
								if (lastSpaceIdx <= 0) continue;
								let branch = line.substring(0, lastSpaceIdx);
								const timestamp = Number.parseInt(
									line.substring(lastSpaceIdx + 1),
									10,
								);

								if (branch.startsWith("origin/")) {
									branch = branch.replace("origin/", "");
								}

								if (!branch || branch === "HEAD") continue;

								branchMap.set(branch, {
									lastCommitDate: timestamp * 1000,
									isLocal: localBranchSet.has(branch),
									isRemote: true,
								});
							}
						} catch {
							for (const name of remoteBranchSet) {
								branchMap.set(name, {
									lastCommitDate: 0,
									isLocal: localBranchSet.has(name),
									isRemote: true,
								});
							}
						}
					}

					try {
						const localBranchInfo = await git.raw([
							"for-each-ref",
							"--sort=-committerdate",
							"--format=%(refname:short) %(committerdate:unix)",
							"refs/heads/",
						]);

						for (const line of localBranchInfo.trim().split("\n")) {
							if (!line) continue;
							const lastSpaceIdx = line.lastIndexOf(" ");
							if (lastSpaceIdx <= 0) continue;
							const branch = line.substring(0, lastSpaceIdx);
							const timestamp = Number.parseInt(
								line.substring(lastSpaceIdx + 1),
								10,
							);

							if (!branch || branch === "HEAD") continue;

							if (!branchMap.has(branch)) {
								branchMap.set(branch, {
									lastCommitDate: timestamp * 1000,
									isLocal: true,
									isRemote: remoteBranchSet.has(branch),
								});
							} else {
								const existing = branchMap.get(branch);
								if (existing) {
									existing.isLocal = true;
								}
							}
						}
					} catch {
						for (const name of localBranchSet) {
							if (!branchMap.has(name)) {
								branchMap.set(name, {
									lastCommitDate: 0,
									isLocal: true,
									isRemote: remoteBranchSet.has(name),
								});
							}
						}
					}

					const checkedOutBranches = await getCheckedOutBranches(
						project.mainRepoPath,
					);

					const branches = Array.from(branchMap.entries()).map(
						([name, data]) => ({
							name,
							...data,
							checkedOutIn: checkedOutBranches.get(name) ?? null,
						}),
					);

					const defaultBranch =
						project.defaultBranch ||
						(await getDefaultBranch(project.mainRepoPath));

					branches.sort((a, b) => {
						if (a.name === defaultBranch) return -1;
						if (b.name === defaultBranch) return 1;
						return b.lastCommitDate - a.lastCommitDate;
					});

					return { branches, defaultBranch };
				},
			),

		// Slow: fetches from remote and returns the full, up-to-date branch list
		getBranches: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(
				async ({
					input,
				}): Promise<{
					branches: Array<{
						name: string;
						lastCommitDate: number;
						isLocal: boolean;
						isRemote: boolean;
						checkedOutIn: "main" | "worktree" | null;
					}>;
					defaultBranch: string;
				}> => {
					const project = localDb
						.select()
						.from(projects)
						.where(eq(projects.id, input.projectId))
						.get();
					if (!project) {
						throw new Error(`Project ${input.projectId} not found`);
					}

					const git = await getSimpleGitWithShellPath(project.mainRepoPath);

					try {
						await git.fetch(["--prune"]);
					} catch {
						// Best effort: continue with locally available refs when offline.
					}

					let hasOrigin = false;
					try {
						const remotes = await git.getRemotes();
						hasOrigin = remotes.some((r) => r.name === "origin");
					} catch {}

					const branchSummary = await git.branch(["-a"]);

					const localBranchSet = new Set<string>();
					const remoteBranchSet = new Set<string>();

					for (const name of Object.keys(branchSummary.branches)) {
						if (name.startsWith("remotes/origin/")) {
							if (name === "remotes/origin/HEAD") continue;
							const remoteName = name.replace("remotes/origin/", "");
							remoteBranchSet.add(remoteName);
						} else {
							localBranchSet.add(name);
						}
					}

					const branchMap = new Map<
						string,
						{ lastCommitDate: number; isLocal: boolean; isRemote: boolean }
					>();

					if (hasOrigin) {
						try {
							const remoteBranchInfo = await git.raw([
								"for-each-ref",
								"--sort=-committerdate",
								"--format=%(refname:short) %(committerdate:unix)",
								"refs/remotes/origin/",
							]);

							for (const line of remoteBranchInfo.trim().split("\n")) {
								if (!line) continue;
								const lastSpaceIdx = line.lastIndexOf(" ");
								if (lastSpaceIdx <= 0) continue;
								let branch = line.substring(0, lastSpaceIdx);
								const timestamp = Number.parseInt(
									line.substring(lastSpaceIdx + 1),
									10,
								);

								// Normalize remote branch names
								if (branch.startsWith("origin/")) {
									branch = branch.replace("origin/", "");
								}

								if (!branch || branch === "HEAD") continue;

								branchMap.set(branch, {
									lastCommitDate: timestamp * 1000,
									isLocal: localBranchSet.has(branch),
									isRemote: true,
								});
							}
						} catch {
							for (const name of remoteBranchSet) {
								branchMap.set(name, {
									lastCommitDate: 0,
									isLocal: localBranchSet.has(name),
									isRemote: true,
								});
							}
						}
					}

					try {
						const localBranchInfo = await git.raw([
							"for-each-ref",
							"--sort=-committerdate",
							"--format=%(refname:short) %(committerdate:unix)",
							"refs/heads/",
						]);

						for (const line of localBranchInfo.trim().split("\n")) {
							if (!line) continue;
							const lastSpaceIdx = line.lastIndexOf(" ");
							if (lastSpaceIdx <= 0) continue;
							const branch = line.substring(0, lastSpaceIdx);
							const timestamp = Number.parseInt(
								line.substring(lastSpaceIdx + 1),
								10,
							);

							if (!branch || branch === "HEAD") continue;

							// Only add if not already in map (remote takes precedence for date)
							if (!branchMap.has(branch)) {
								branchMap.set(branch, {
									lastCommitDate: timestamp * 1000,
									isLocal: true,
									isRemote: remoteBranchSet.has(branch),
								});
							} else {
								// Update isLocal flag for branches that exist both locally and remotely
								const existing = branchMap.get(branch);
								if (existing) {
									existing.isLocal = true;
								}
							}
						}
					} catch {
						// Fallback for local branches
						for (const name of localBranchSet) {
							if (!branchMap.has(name)) {
								branchMap.set(name, {
									lastCommitDate: 0,
									isLocal: true,
									isRemote: remoteBranchSet.has(name),
								});
							}
						}
					}

					const checkedOutBranches = await getCheckedOutBranches(
						project.mainRepoPath,
					);

					const branches = Array.from(branchMap.entries()).map(
						([name, data]) => ({
							name,
							...data,
							checkedOutIn: checkedOutBranches.get(name) ?? null,
						}),
					);

					// Sync with remote in case the default branch changed (e.g. master -> main)
					const remoteDefaultBranch = await refreshDefaultBranch(
						project.mainRepoPath,
					);

					const defaultBranch =
						remoteDefaultBranch ||
						project.defaultBranch ||
						(await getDefaultBranch(project.mainRepoPath));

					if (defaultBranch !== project.defaultBranch) {
						localDb
							.update(projects)
							.set({ defaultBranch })
							.where(eq(projects.id, input.projectId))
							.run();
					}

					// Sort: default branch first, then by date
					branches.sort((a, b) => {
						if (a.name === defaultBranch) return -1;
						if (b.name === defaultBranch) return 1;
						return b.lastCommitDate - a.lastCommitDate;
					});

					return { branches, defaultBranch };
				},
			),

		// Paginated, server-side searched branch listing
		searchBranches: publicProcedure
			.input(
				z.object({
					projectId: z.string(),
					search: z.string().default(""),
					limit: z.number().min(1).max(BRANCH_SEARCH_LIMIT).default(50),
					offset: z.number().min(0).default(0),
				}),
			)
			.query(
				async ({
					input,
				}): Promise<{
					branches: Array<{
						name: string;
						lastCommitDate: number;
						isLocal: boolean;
						isRemote: boolean;
					}>;
					defaultBranch: string;
					totalCount: number;
					hasMore: boolean;
				}> => {
					const project = localDb
						.select()
						.from(projects)
						.where(eq(projects.id, input.projectId))
						.get();
					if (!project) {
						throw new Error(`Project ${input.projectId} not found`);
					}

					const git = await getSimpleGitWithShellPath(project.mainRepoPath);
					const search = input.search.trim();
					const searchLower = search.toLowerCase();

					// Always list all refs — git glob `*` doesn't cross `/` and is
					// case-sensitive, so we filter in JS for reliable substring search.
					const localPattern = "refs/heads/";
					const remotePattern = "refs/remotes/origin/";

					const branchMap = new Map<
						string,
						{ lastCommitDate: number; isLocal: boolean; isRemote: boolean }
					>();

					// Fetch remote refs
					try {
						const remoteOutput = await git.raw([
							"for-each-ref",
							"--sort=-committerdate",
							"--format=%(refname:short) %(committerdate:unix)",
							remotePattern,
						]);

						for (const line of remoteOutput.trim().split("\n")) {
							if (!line) continue;
							const lastSpaceIdx = line.lastIndexOf(" ");
							let branch = line.substring(0, lastSpaceIdx);
							const timestamp = Number.parseInt(
								line.substring(lastSpaceIdx + 1),
								10,
							);

							if (branch.startsWith("origin/")) {
								branch = branch.replace("origin/", "");
							}
							if (branch === "HEAD") continue;

							branchMap.set(branch, {
								lastCommitDate: timestamp * 1000,
								isLocal: false,
								isRemote: true,
							});
						}
					} catch (err) {
						console.warn("[searchBranches] Failed to list remote refs:", err);
					}

					// Fetch local refs
					try {
						const localOutput = await git.raw([
							"for-each-ref",
							"--sort=-committerdate",
							"--format=%(refname:short) %(committerdate:unix)",
							localPattern,
						]);

						for (const line of localOutput.trim().split("\n")) {
							if (!line) continue;
							const lastSpaceIdx = line.lastIndexOf(" ");
							const branch = line.substring(0, lastSpaceIdx);
							const timestamp = Number.parseInt(
								line.substring(lastSpaceIdx + 1),
								10,
							);

							if (branch === "HEAD") continue;

							const existing = branchMap.get(branch);
							if (existing) {
								existing.isLocal = true;
							} else {
								branchMap.set(branch, {
									lastCommitDate: timestamp * 1000,
									isLocal: true,
									isRemote: false,
								});
							}
						}
					} catch (err) {
						console.warn("[searchBranches] Failed to list local refs:", err);
					}

					const defaultBranch =
						project.defaultBranch ||
						(await getDefaultBranch(project.mainRepoPath));

					// Sort: default branch first, then local before remote, then by date
					const allBranches = Array.from(branchMap.entries())
						.filter(
							([name]) =>
								!searchLower || name.toLowerCase().includes(searchLower),
						)
						.map(([name, data]) => ({ name, ...data }))
						.sort((a, b) => {
							if (a.name === defaultBranch) return -1;
							if (b.name === defaultBranch) return 1;
							if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
							return b.lastCommitDate - a.lastCommitDate;
						});

					const totalCount = allBranches.length;
					const branches = allBranches.slice(
						input.offset,
						input.offset + input.limit,
					);

					return {
						branches,
						defaultBranch,
						totalCount,
						hasMore: input.offset + input.limit < totalCount,
					};
				},
			),

		openNew: publicProcedure.mutation(async (): Promise<OpenNewMultiResult> => {
			const window = getWindow();
			if (!window) {
				return { canceled: false, error: "No window available" };
			}
			const result = await dialog.showOpenDialog(window, {
				properties: ["openDirectory", "multiSelections"],
				title: "Open Project",
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { canceled: true };
			}

			const outcomes: FolderOutcome[] = [];

			for (const selectedPath of result.filePaths) {
				try {
					const mainRepoPath = await getGitRoot(selectedPath);
					const defaultBranch = await getDefaultBranch(mainRepoPath);

					const project = upsertProject(mainRepoPath, defaultBranch);
					await ensureMainWorkspace(project);

					track("project_opened", {
						project_id: project.id,
						method: "open",
					});

					outcomes.push({ status: "success", project });
				} catch (gitError) {
					if (gitError instanceof NotGitRepoError) {
						outcomes.push({ status: "needsGitInit", selectedPath });
					} else {
						const msg =
							gitError instanceof Error ? gitError.message : String(gitError);
						console.error(
							"[projects/openNew] Failed to open project:",
							selectedPath,
							gitError,
						);
						outcomes.push({
							status: "error",
							selectedPath,
							error: msg,
						});
					}
				}
			}

			return { canceled: false, multi: true, results: outcomes };
		}),

		openFromPath: publicProcedure
			.input(z.object({ path: z.string() }))
			.mutation(async ({ input }): Promise<OpenNewResult> => {
				const selectedPath = input.path;

				if (!existsSync(selectedPath)) {
					return { canceled: false, error: "Path does not exist" };
				}

				try {
					const stats = statSync(selectedPath);
					if (!stats.isDirectory()) {
						return {
							canceled: false,
							error: "Please drop a folder, not a file",
						};
					}
				} catch {
					return {
						canceled: false,
						error: "Could not access the dropped item",
					};
				}

				let mainRepoPath: string;
				try {
					mainRepoPath = await getGitRoot(selectedPath);
				} catch (error) {
					if (error instanceof NotGitRepoError) {
						return {
							canceled: false,
							needsGitInit: true as const,
							selectedPath,
						};
					}
					throw error;
				}

				const defaultBranch = await getDefaultBranch(mainRepoPath);

				const project = upsertProject(mainRepoPath, defaultBranch);
				await ensureMainWorkspace(project);

				track("project_opened", {
					project_id: project.id,
					method: "drop",
				});

				return {
					canceled: false,
					project,
				};
			}),

		initGitAndOpen: publicProcedure
			.input(z.object({ path: z.string() }))
			.mutation(async ({ input }) => {
				const { defaultBranch } = await initGitRepo(input.path);

				const project = upsertProject(input.path, defaultBranch);
				await ensureMainWorkspace(project);

				track("project_opened", {
					project_id: project.id,
					method: "init",
				});

				return { project };
			}),

		openAsGitless: publicProcedure
			.input(z.object({ path: z.string() }))
			.mutation(async ({ input }) => {
				const selectedPath = input.path;

				if (!existsSync(selectedPath)) {
					return { canceled: false as const, error: "Path does not exist" };
				}

				try {
					const stats = statSync(selectedPath);
					if (!stats.isDirectory()) {
						return {
							canceled: false as const,
							error: "Path is not a directory",
						};
					}
				} catch {
					return {
						canceled: false as const,
						error: "Could not access the path",
					};
				}

				// Reject paths that already have git initialized
				try {
					await getGitRoot(selectedPath);
					return {
						canceled: false as const,
						error: "This folder already has git initialized",
					};
				} catch (error) {
					if (!(error instanceof NotGitRepoError)) throw error;
				}

				// Reuse existing project record if already opened
				const existing = localDb
					.select()
					.from(projects)
					.where(eq(projects.mainRepoPath, selectedPath))
					.get();

				if (existing) {
					localDb
						.update(projects)
						.set({ lastOpenedAt: Date.now() })
						.where(eq(projects.id, existing.id))
						.run();
					await ensureGitlessWorkspace({
						...existing,
						lastOpenedAt: Date.now(),
					});
					return { canceled: false as const, project: existing };
				}

				const name = basename(selectedPath);
				const project = localDb
					.insert(projects)
					.values({
						mainRepoPath: selectedPath,
						name,
						color: getAutoProjectColor(getExistingProjectColors()),
						iconLetter: getAutoProjectAbbreviation(name),
						isGitless: true,
					})
					.returning()
					.get();

				await ensureGitlessWorkspace(project);

				track("project_opened", { project_id: project.id, method: "gitless" });

				return { canceled: false as const, project };
			}),

		cloneRepo: publicProcedure
			.input(
				z.object({
					url: z
						.string()
						.min(1)
						.refine(
							(val) => {
								try {
									const parsed = new URL(val);
									return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
								} catch {
									return SSH_GIT_URL_REGEX.test(val);
								}
							},
							{ message: "Must be a valid Git URL (HTTPS or SSH)" },
						),
					// Trim and convert empty/whitespace strings to undefined
					targetDirectory: z
						.string()
						.trim()
						.optional()
						.transform((v) => (v && v.length > 0 ? v : undefined)),
				}),
			)
			.mutation(async ({ input }) => {
				try {
					let targetDir = input.targetDirectory;

					if (!targetDir) {
						const window = getWindow();
						if (!window) {
							return {
								canceled: false as const,
								success: false as const,
								error: "No window available",
							};
						}
						const result = await dialog.showOpenDialog(window, {
							properties: ["openDirectory", "createDirectory"],
							title: "Select Clone Destination",
						});

						// User canceled - return canceled state (not an error)
						if (result.canceled || result.filePaths.length === 0) {
							return { canceled: true as const, success: false as const };
						}

						targetDir = result.filePaths[0];
					}

					const repoName = extractRepoName(input.url);
					if (!repoName) {
						return {
							canceled: false as const,
							success: false as const,
							error: "Invalid repository URL",
						};
					}

					const clonePath = join(targetDir, repoName);

					// Check if we already have a project for this path
					const existingProject = localDb
						.select()
						.from(projects)
						.where(eq(projects.mainRepoPath, clonePath))
						.get();

					if (existingProject) {
						// Verify the filesystem path still exists
						try {
							await access(clonePath);
							// Directory exists - update lastOpenedAt and return existing project
							localDb
								.update(projects)
								.set({ lastOpenedAt: Date.now() })
								.where(eq(projects.id, existingProject.id))
								.run();

							// Auto-create main workspace if it doesn't exist
							await ensureMainWorkspace({
								...existingProject,
								lastOpenedAt: Date.now(),
							});

							track("project_opened", {
								project_id: existingProject.id,
								method: "clone",
							});

							return {
								canceled: false as const,
								success: true as const,
								project: { ...existingProject, lastOpenedAt: Date.now() },
							};
						} catch {
							// Directory is missing - remove the stale project record and continue with clone
							localDb
								.delete(projects)
								.where(eq(projects.id, existingProject.id))
								.run();
						}
					}

					// Check if target directory already exists (but not our project)
					if (existsSync(clonePath)) {
						return {
							canceled: false as const,
							success: false as const,
							error: `A folder named "${repoName}" already exists at this location. Please choose a different destination.`,
						};
					}

					// Clone the repository
					const git = await getSimpleGitWithShellPath();
					await git.clone(input.url, clonePath);

					// Create new project
					const name = basename(clonePath);
					const defaultBranch = await getDefaultBranch(clonePath);
					const project = localDb
						.insert(projects)
						.values({
							mainRepoPath: clonePath,
							name,
							color: getAutoProjectColor(getExistingProjectColors()),
							iconLetter: getAutoProjectAbbreviation(name),
							defaultBranch,
						})
						.returning()
						.get();

					// Auto-create main workspace if it doesn't exist
					await ensureMainWorkspace(project);

					track("project_opened", {
						project_id: project.id,
						method: "clone",
					});

					return {
						canceled: false as const,
						success: true as const,
						project,
					};
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						canceled: false as const,
						success: false as const,
						error: `Failed to clone repository: ${errorMessage}`,
					};
				}
			}),

		createEmptyRepo: publicProcedure
			.input(
				z.object({
					name: z
						.string()
						.min(1)
						.refine(
							(val) => SAFE_REPO_NAME_REGEX.test(val) && !/^\.+$/.test(val),
							{
								message:
									"Name can only contain letters, numbers, dots, underscores, hyphens, and spaces",
							},
						),
					parentDir: z.string().min(1),
				}),
			)
			.mutation(async ({ input }) => {
				try {
					const repoPath = join(input.parentDir, input.name);

					if (existsSync(repoPath)) {
						return {
							canceled: false as const,
							success: false as const,
							error: `A folder named "${input.name}" already exists at this location.`,
						};
					}

					await mkdir(repoPath, { recursive: true });

					let defaultBranch: string;
					try {
						({ defaultBranch } = await initGitRepo(repoPath));
					} catch (gitErr) {
						await rm(repoPath, { recursive: true, force: true });
						throw gitErr;
					}
					const project = upsertProject(repoPath, defaultBranch);
					await ensureMainWorkspace(project);

					track("project_opened", {
						project_id: project.id,
						method: "create_empty",
					});

					return {
						canceled: false as const,
						success: true as const,
						project,
					};
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					return {
						canceled: false as const,
						success: false as const,
						error: `Failed to create repository: ${errorMessage}`,
					};
				}
			}),

		update: publicProcedure
			.input(
				z.object({
					id: z.string(),
					patch: z.object({
						name: z.string().trim().min(1).optional(),
						color: z
							.string()
							.refine(
								(value) => PROJECT_COLOR_VALUES.includes(value),
								"Invalid project color",
							)
							.optional(),
						branchPrefixMode: z.enum(BRANCH_PREFIX_MODES).nullable().optional(),
						branchPrefixCustom: z.string().nullable().optional(),
						workspaceBaseBranch: z.string().nullable().optional(),
						worktreeBaseDir: z.string().nullable().optional(),
						hideImage: z.boolean().optional(),
						iconLetter: z.string().max(3).nullable().optional(),
						defaultApp: z.enum(EXTERNAL_APPS).nullable().optional(),
					}),
				}),
			)
			.mutation(({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();
				if (!project) {
					throw new Error(`Project ${input.id} not found`);
				}

				localDb
					.update(projects)
					.set({
						...(input.patch.name !== undefined && { name: input.patch.name }),
						...(input.patch.color !== undefined && {
							color: input.patch.color,
						}),
						...(input.patch.branchPrefixMode !== undefined && {
							branchPrefixMode: input.patch.branchPrefixMode,
						}),
						...(input.patch.branchPrefixCustom !== undefined && {
							branchPrefixCustom: input.patch.branchPrefixCustom,
						}),
						...(input.patch.workspaceBaseBranch !== undefined && {
							workspaceBaseBranch: input.patch.workspaceBaseBranch,
						}),
						...(input.patch.worktreeBaseDir !== undefined && {
							worktreeBaseDir: input.patch.worktreeBaseDir,
						}),
						...(input.patch.hideImage !== undefined && {
							hideImage: input.patch.hideImage,
						}),
						...(input.patch.iconLetter !== undefined && {
							iconLetter: input.patch.iconLetter,
						}),
						...(input.patch.defaultApp !== undefined && {
							defaultApp: input.patch.defaultApp,
						}),
						lastOpenedAt: Date.now(),
					})
					.where(eq(projects.id, input.id))
					.run();

				return { success: true };
			}),

		reorder: publicProcedure
			.input(
				z.object({
					fromIndex: z.number(),
					toIndex: z.number(),
				}),
			)
			.mutation(({ input }) => {
				const { fromIndex, toIndex } = input;

				const activeProjects = localDb
					.select()
					.from(projects)
					.where(eq(projects.tabOrder, projects.tabOrder)) // Just get all with non-null tabOrder
					.all()
					.filter((p) => p.tabOrder !== null)
					.sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0));

				if (
					fromIndex < 0 ||
					fromIndex >= activeProjects.length ||
					toIndex < 0 ||
					toIndex >= activeProjects.length
				) {
					throw new Error("Invalid fromIndex or toIndex");
				}

				const [removed] = activeProjects.splice(fromIndex, 1);
				activeProjects.splice(toIndex, 0, removed);

				for (let i = 0; i < activeProjects.length; i++) {
					localDb
						.update(projects)
						.set({ tabOrder: i })
						.where(eq(projects.id, activeProjects[i].id))
						.run();
				}

				return { success: true };
			}),

		refreshDefaultBranch: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					throw new Error(`Project ${input.id} not found`);
				}

				const remoteDefaultBranch = await refreshDefaultBranch(
					project.mainRepoPath,
				);

				if (
					remoteDefaultBranch &&
					remoteDefaultBranch !== project.defaultBranch
				) {
					localDb
						.update(projects)
						.set({ defaultBranch: remoteDefaultBranch })
						.where(eq(projects.id, input.id))
						.run();

					return {
						success: true,
						defaultBranch: remoteDefaultBranch,
						changed: true,
						previousBranch: project.defaultBranch,
					};
				}

				// Ensure we always return a valid default branch
				const defaultBranch =
					project.defaultBranch ??
					remoteDefaultBranch ??
					(await getDefaultBranch(project.mainRepoPath));

				return {
					success: true,
					defaultBranch,
					changed: false,
				};
			}),

		getCloseWarnings: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project || project.isGitless) {
					return { warnings: [] };
				}

				const projectWorktrees = localDb
					.select()
					.from(worktrees)
					.where(eq(worktrees.projectId, input.id))
					.all();

				type WarningEntry = {
					branch: string;
					hasChanges: boolean;
					hasUnpushedCommits: boolean;
				};

				const checks: Promise<WarningEntry | null>[] = [];

				// Check the main repo (branch workspace)
				checks.push(
					(async (): Promise<WarningEntry | null> => {
						try {
							const [changes, unpushed] = await Promise.all([
								hasUncommittedChanges(project.mainRepoPath),
								hasUnpushedCommits(project.mainRepoPath),
							]);
							if (!changes && !unpushed) return null;
							const branch = await getCurrentBranch(project.mainRepoPath);
							return {
								branch: branch ?? "(main)",
								hasChanges: changes,
								hasUnpushedCommits: unpushed,
							};
						} catch {
							return null;
						}
					})(),
				);

				// Check each worktree
				for (const worktree of projectWorktrees) {
					checks.push(
						(async (): Promise<WarningEntry | null> => {
							try {
								const [changes, unpushed] = await Promise.all([
									hasUncommittedChanges(worktree.path),
									hasUnpushedCommits(worktree.path),
								]);
								if (!changes && !unpushed) return null;
								return {
									branch: worktree.branch,
									hasChanges: changes,
									hasUnpushedCommits: unpushed,
								};
							} catch {
								return null;
							}
						})(),
					);
				}

				const results = await Promise.all(checks);
				const warnings = results.filter((r): r is WarningEntry => r !== null);
				const worktreePaths = projectWorktrees.map((wt) => wt.path);

				return { warnings, worktreePaths };
			}),

		close: publicProcedure
			.input(
				z.object({
					id: z.string(),
					deleteFromDisk: z.boolean().default(false),
				}),
			)
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					throw new Error("Project not found");
				}

				// Collect worktree paths before deleting rows (needed for disk cleanup)
				const worktreePathsToDelete: string[] = [];

				// For feature projects, cascade cleanup to all child repos first
				const registry = getWorkspaceRuntimeRegistry();
				const allDeletedWorkspaceIds: string[] = [];
				if (project.isFeatureProject) {
					const childProjects = localDb
						.select()
						.from(projects)
						.where(eq(projects.parentProjectId, input.id))
						.all();
					for (const child of childProjects) {
						const childWorkspaces = localDb
							.select()
							.from(workspaces)
							.where(eq(workspaces.projectId, child.id))
							.all();
						for (const ws of childWorkspaces) {
							const terminal = registry.getForWorkspaceId(ws.id).terminal;
							await terminal.killByWorkspaceId(ws.id);
						}
						const childWorkspaceIds = childWorkspaces.map((w) => w.id);
						allDeletedWorkspaceIds.push(...childWorkspaceIds);
						if (childWorkspaceIds.length > 0) {
							localDb
								.delete(workspaces)
								.where(inArray(workspaces.id, childWorkspaceIds))
								.run();
						}
						if (input.deleteFromDisk && !project.isGitless) {
							localDb
								.select({ path: worktrees.path })
								.from(worktrees)
								.where(eq(worktrees.projectId, child.id))
								.all()
								.forEach((wt) => worktreePathsToDelete.push(wt.path));
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
					}
				}

				const projectWorkspaces = localDb
					.select()
					.from(workspaces)
					.where(eq(workspaces.projectId, input.id))
					.all();

				let totalFailed = 0;
				for (const workspace of projectWorkspaces) {
					const terminal = registry.getForWorkspaceId(workspace.id).terminal;
					const terminalResult = await terminal.killByWorkspaceId(workspace.id);
					totalFailed += terminalResult.failed;
				}

				const closedWorkspaceIds = projectWorkspaces.map((w) => w.id);
				allDeletedWorkspaceIds.push(...closedWorkspaceIds);

				if (closedWorkspaceIds.length > 0) {
					localDb
						.delete(workspaces)
						.where(inArray(workspaces.id, closedWorkspaceIds))
						.run();
				}

				if (input.deleteFromDisk && !project.isGitless) {
					localDb
						.select({ path: worktrees.path })
						.from(worktrees)
						.where(eq(worktrees.projectId, input.id))
						.all()
						.forEach((wt) => worktreePathsToDelete.push(wt.path));
				}
				localDb
					.delete(worktrees)
					.where(eq(worktrees.projectId, input.id))
					.run();

				localDb
					.delete(workspaceSections)
					.where(eq(workspaceSections.projectId, input.id))
					.run();

				deleteProjectIcon(input.id);

				localDb.delete(projects).where(eq(projects.id, input.id)).run();

				// Update active workspace if it was in this project or any child repos
				const currentSettings = localDb.select().from(settings).get();
				if (
					currentSettings?.lastActiveWorkspaceId &&
					allDeletedWorkspaceIds.includes(currentSettings.lastActiveWorkspaceId)
				) {
					setLastActiveWorkspace(selectNextActiveWorkspace());
				}

				const terminalWarning =
					totalFailed > 0
						? `${totalFailed} terminal process(es) may still be running`
						: undefined;

				track("project_closed", { project_id: input.id });

				// Delete files from disk if requested
				if (input.deleteFromDisk && project.isFeatureProject) {
					// For multi-repo feature projects, delete the entire project folder
					// (which contains all cloned repos as subdirectories)
					await rm(project.mainRepoPath, { recursive: true, force: true });
				} else if (input.deleteFromDisk && !project.isGitless) {
					const mainRepoPrefix = project.mainRepoPath + sep;
					// Delete external worktree dirs first (ones not nested inside mainRepoPath,
					// since those will be removed when the main repo is deleted below)
					const externalWorktreePaths = worktreePathsToDelete.filter(
						(p) => !p.startsWith(mainRepoPrefix),
					);
					await Promise.all(
						externalWorktreePaths.map((p) =>
							rm(p, { recursive: true, force: true }).catch((err) => {
								console.warn(
									`[projects/close] Failed to delete worktree dir ${p}:`,
									err,
								);
							}),
						),
					);
					await rm(project.mainRepoPath, { recursive: true, force: true });
				}

				return { success: true, terminalWarning };
			}),

		getGitAuthor: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					return null;
				}

				const authorName = await getGitAuthorName(project.mainRepoPath);
				if (!authorName) {
					return null;
				}

				return {
					name: authorName,
					prefix: sanitizeAuthorPrefix(authorName),
				};
			}),

		triggerFaviconDiscovery: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Project ${input.id} not found`,
					});
				}

				// Skip if the project already has an icon
				if (project.iconUrl) {
					return { iconUrl: project.iconUrl };
				}

				const iconUrl = await discoverAndSaveProjectIcon({
					projectId: project.id,
					repoPath: project.mainRepoPath,
				});

				if (iconUrl) {
					localDb
						.update(projects)
						.set({ iconUrl })
						.where(eq(projects.id, input.id))
						.run();
				}

				return { iconUrl };
			}),

		setProjectIcon: publicProcedure
			.input(
				z.object({
					id: z.string(),
					icon: z.string().nullable(),
				}),
			)
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.id))
					.get();

				if (!project) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: `Project ${input.id} not found`,
					});
				}

				if (input.icon === null) {
					// Remove icon
					deleteProjectIcon(input.id);
					localDb
						.update(projects)
						.set({ iconUrl: null })
						.where(eq(projects.id, input.id))
						.run();
					return { iconUrl: null };
				}

				// Save icon from data URL
				const iconUrl = await saveProjectIconFromDataUrl({
					projectId: input.id,
					dataUrl: input.icon,
				});

				localDb
					.update(projects)
					.set({ iconUrl })
					.where(eq(projects.id, input.id))
					.run();

				return { iconUrl };
			}),
	});
};

export type ProjectsRouter = ReturnType<typeof createProjectsRouter>;
