import { existsSync } from "node:fs";
import type {
	GitHubStatus,
	SelectProject,
	SelectWorkspace,
} from "@superset/local-db";
import { projects, workspaces, worktrees } from "@superset/local-db";
import { observable } from "@trpc/server/observable";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
	type GitBatchProgress,
	gitBatchProgressEmitter,
} from "main/lib/git-batch-progress";
import { localDb } from "main/lib/local-db";
import { z } from "zod";
import { publicProcedure, router } from "../../..";
import { clearStatusCacheForWorktree } from "../../changes/utils/status-cache";
import {
	getProject,
	getWorkspace,
	getWorktree,
	resolveWorkspaceCheckoutPath,
	updateProjectDefaultBranch,
} from "../utils/db-helpers";
import {
	fetchDefaultBranch,
	fetchRemote,
	getAheadBehindCount,
	getDefaultBranch,
	listExternalWorktrees,
	type PullAllSkipReason,
	pullWorktreeIfClean,
	refreshDefaultBranch,
} from "../utils/git";

/** Default staleness window for background auto-fetch: 15 minutes. */
const AUTO_FETCH_STALE_MS = 15 * 60 * 1000;

import {
	clearGitHubCachesForWorktree,
	fetchGitHubPRComments,
	fetchGitHubPRStatus,
	type PullRequestCommentsTarget,
	resolveReviewThread,
} from "../utils/github";

const gitHubPRCommentsInputSchema = z.object({
	workspaceId: z.string(),
	prNumber: z.number().int().positive().optional(),
	repoUrl: z.string().optional(),
	upstreamUrl: z.string().optional(),
	isFork: z.boolean().optional(),
});

function resolveCommentsPullRequestTarget({
	input,
	githubStatus,
}: {
	input: z.infer<typeof gitHubPRCommentsInputSchema>;
	githubStatus: GitHubStatus | null | undefined;
}): PullRequestCommentsTarget | null {
	const prNumber = input.prNumber ?? githubStatus?.pr?.number;
	if (!prNumber) {
		return null;
	}

	const repoUrl = input.repoUrl ?? githubStatus?.repoUrl;
	if (!repoUrl) {
		return null;
	}

	const upstreamUrl =
		input.upstreamUrl ?? githubStatus?.upstreamUrl ?? githubStatus?.repoUrl;
	if (!upstreamUrl) {
		return null;
	}

	return {
		prNumber,
		repoContext: {
			repoUrl,
			upstreamUrl,
			isFork: input.isFork ?? githubStatus?.isFork ?? false,
		},
	};
}

function stripGitHubStatusTimestamp(
	status: GitHubStatus | null | undefined,
): Omit<GitHubStatus, "lastRefreshed"> | null {
	if (!status) {
		return null;
	}

	const { lastRefreshed: _lastRefreshed, ...rest } = status;
	return rest;
}

function hasMeaningfulGitHubStatusChange({
	current,
	next,
}: {
	current: GitHubStatus | null | undefined;
	next: GitHubStatus;
}): boolean {
	return (
		JSON.stringify(stripGitHubStatusTimestamp(current)) !==
		JSON.stringify(stripGitHubStatusTimestamp(next))
	);
}

export const createGitStatusProcedures = () => {
	return router({
		refreshGitStatus: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					throw new Error(`Workspace ${input.workspaceId} not found`);
				}

				const worktree = workspace.worktreeId
					? getWorktree(workspace.worktreeId)
					: null;
				if (!worktree) {
					throw new Error(
						`Worktree for workspace ${input.workspaceId} not found`,
					);
				}

				const project = getProject(workspace.projectId);
				if (!project) {
					throw new Error(`Project ${workspace.projectId} not found`);
				}

				const remoteDefaultBranch = await refreshDefaultBranch(
					project.mainRepoPath,
				);

				let defaultBranch = project.defaultBranch;
				if (!defaultBranch) {
					defaultBranch = await getDefaultBranch(project.mainRepoPath);
				}
				if (remoteDefaultBranch && remoteDefaultBranch !== defaultBranch) {
					defaultBranch = remoteDefaultBranch;
				}

				if (defaultBranch !== project.defaultBranch) {
					updateProjectDefaultBranch(project.id, defaultBranch);
				}

				await fetchDefaultBranch(project.mainRepoPath, defaultBranch);

				const { ahead, behind } = await getAheadBehindCount({
					repoPath: worktree.path,
					defaultBranch,
				});

				const gitStatus = {
					branch: worktree.branch,
					needsRebase: behind > 0,
					ahead,
					behind,
					lastRefreshed: Date.now(),
				};

				localDb
					.update(worktrees)
					.set({ gitStatus })
					.where(eq(worktrees.id, worktree.id))
					.run();

				return { gitStatus, defaultBranch };
			}),

		getAheadBehind: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					return { ahead: 0, behind: 0 };
				}

				const project = getProject(workspace.projectId);
				if (!project) {
					return { ahead: 0, behind: 0 };
				}

				const repoPath = resolveWorkspaceCheckoutPath({ workspace, project });

				return getAheadBehindCount({
					repoPath,
					defaultBranch: workspace.branch,
				});
			}),

		getAheadBehindBatch: publicProcedure
			.input(z.object({ workspaceIds: z.array(z.string()) }))
			.query(async ({ input }) => {
				const entries = await Promise.all(
					input.workspaceIds.map(async (workspaceId) => {
						const workspace = getWorkspace(workspaceId);
						const project = workspace ? getProject(workspace.projectId) : null;
						if (!workspace || !project) {
							return [workspaceId, { ahead: 0, behind: 0 }] as const;
						}
						const counts = await getAheadBehindCount({
							repoPath: resolveWorkspaceCheckoutPath({ workspace, project }),
							defaultBranch: workspace.branch,
						});
						return [workspaceId, counts] as const;
					}),
				);
				return Object.fromEntries(entries) as Record<
					string,
					{ ahead: number; behind: number }
				>;
			}),

		/**
		 * Background auto-fetch: fetches the remote for every git-backed repo
		 * whose workspaces haven't been fetched within `staleMs`. Fetches once
		 * per repo (worktrees share remote-tracking refs) and stamps
		 * `lastFetchedAt` on all of that repo's workspaces. Returns the ids of
		 * workspaces whose repo was successfully fetched so callers can refresh
		 * ahead/behind counts. Pass `staleMs: 0` to force-fetch every repo
		 * regardless of when it was last fetched (e.g. a manual "Fetch All").
		 */
		autoFetchStaleWorkspaces: publicProcedure
			.input(
				z
					.object({ staleMs: z.number().int().nonnegative().optional() })
					.optional(),
			)
			.mutation(async ({ input }) => {
				const staleMs = input?.staleMs ?? AUTO_FETCH_STALE_MS;
				const now = Date.now();
				const threshold = now - staleMs;

				const rows = localDb
					.select({ workspace: workspaces, project: projects })
					.from(workspaces)
					.innerJoin(projects, eq(workspaces.projectId, projects.id))
					.where(isNull(workspaces.deletingAt))
					.all();

				const byProject = new Map<
					string,
					{ project: SelectProject; workspaces: SelectWorkspace[] }
				>();
				for (const { workspace, project } of rows) {
					if (project.isGitless) continue;
					const entry = byProject.get(project.id);
					if (entry) {
						entry.workspaces.push(workspace);
					} else {
						byProject.set(project.id, { project, workspaces: [workspace] });
					}
				}

				const staleEntries = Array.from(byProject.values()).filter(
					({ workspaces: repoWorkspaces }) => {
						const newestFetch = repoWorkspaces.reduce(
							(max, w) => Math.max(max, w.lastFetchedAt ?? 0),
							0,
						);
						return newestFetch <= threshold;
					},
				);

				const total = staleEntries.length;
				const fetchedWorkspaceIds: string[] = [];
				gitBatchProgressEmitter.emit("progress", {
					operation: "fetch",
					done: 0,
					total,
				} satisfies GitBatchProgress);

				for (const [
					index,
					{ project, workspaces: repoWorkspaces },
				] of staleEntries.entries()) {
					try {
						await fetchRemote(project.mainRepoPath);
						const ids = repoWorkspaces.map((w) => w.id);
						localDb
							.update(workspaces)
							.set({ lastFetchedAt: now })
							.where(inArray(workspaces.id, ids))
							.run();
						fetchedWorkspaceIds.push(...ids);
					} catch {
						// Offline or no remote — leave lastFetchedAt unchanged so we
						// retry on the next tick.
					} finally {
						gitBatchProgressEmitter.emit("progress", {
							operation: "fetch",
							done: index + 1,
							total,
						} satisfies GitBatchProgress);
					}
				}

				return { fetchedWorkspaceIds };
			}),

		/**
		 * Pulls the given git-backed workspaces (or every one, if `workspaceIds`
		 * is omitted) whose worktree is clean, skipping (not force-pulling) any
		 * that are dirty, have no upstream, or hit a rebase conflict. Dedupes by
		 * resolved checkout path since branch-type workspaces share their
		 * project's `mainRepoPath`.
		 */
		pullAllWorkspaces: publicProcedure
			.input(
				z.object({ workspaceIds: z.array(z.string()).optional() }).optional(),
			)
			.mutation(async ({ input }) => {
				const workspaceIds = input?.workspaceIds
					? new Set(input.workspaceIds)
					: null;

				const rows = localDb
					.select({ workspace: workspaces, project: projects })
					.from(workspaces)
					.innerJoin(projects, eq(workspaces.projectId, projects.id))
					.where(isNull(workspaces.deletingAt))
					.all();

				const seenPaths = new Set<string>();
				const eligible: { workspace: SelectWorkspace; worktreePath: string }[] =
					[];
				for (const { workspace, project } of rows) {
					if (project.isGitless) continue;
					if (workspaceIds && !workspaceIds.has(workspace.id)) continue;

					const worktreePath = resolveWorkspaceCheckoutPath({
						workspace,
						project,
					});

					if (!existsSync(worktreePath) || seenPaths.has(worktreePath)) {
						continue;
					}
					seenPaths.add(worktreePath);
					eligible.push({ workspace, worktreePath });
				}

				const total = eligible.length;
				const pulled: string[] = [];
				const skipped: { workspaceId: string; reason: PullAllSkipReason }[] =
					[];
				gitBatchProgressEmitter.emit("progress", {
					operation: "pull",
					done: 0,
					total,
				} satisfies GitBatchProgress);

				for (const [index, { workspace, worktreePath }] of eligible.entries()) {
					const result = await pullWorktreeIfClean(worktreePath);
					if (result.status === "pulled") {
						pulled.push(workspace.id);
						clearStatusCacheForWorktree(worktreePath);
					} else {
						skipped.push({ workspaceId: workspace.id, reason: result.reason });
					}
					gitBatchProgressEmitter.emit("progress", {
						operation: "pull",
						done: index + 1,
						total,
					} satisfies GitBatchProgress);
				}

				return { pulled, skipped };
			}),

		onGitBatchProgress: publicProcedure.subscription(() => {
			return observable<GitBatchProgress>((emit) => {
				const handler = (progress: GitBatchProgress) => {
					emit.next(progress);
				};
				gitBatchProgressEmitter.on("progress", handler);
				return () => {
					gitBatchProgressEmitter.off("progress", handler);
				};
			});
		}),

		getGitHubStatus: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					return null;
				}

				const worktree = workspace.worktreeId
					? getWorktree(workspace.worktreeId)
					: null;
				if (!worktree) {
					return null;
				}

				const freshStatus = await fetchGitHubPRStatus(worktree.path);

				if (
					freshStatus &&
					hasMeaningfulGitHubStatusChange({
						current: worktree.githubStatus,
						next: freshStatus,
					})
				) {
					localDb
						.update(worktrees)
						.set({ githubStatus: freshStatus })
						.where(eq(worktrees.id, worktree.id))
						.run();
				}

				return freshStatus;
			}),

		getGitHubPRComments: publicProcedure
			.input(gitHubPRCommentsInputSchema)
			.query(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					return [];
				}

				const worktree = workspace.worktreeId
					? getWorktree(workspace.worktreeId)
					: null;
				if (!worktree) {
					return [];
				}

				const cachedGitHubStatus = worktree.githubStatus ?? null;

				return fetchGitHubPRComments({
					worktreePath: worktree.path,
					pullRequest: resolveCommentsPullRequestTarget({
						input,
						githubStatus: cachedGitHubStatus,
					}),
				});
			}),

		resolveReviewThread: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					threadId: z.string(),
					resolve: z.boolean(),
				}),
			)
			.mutation(async ({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					throw new Error(`Workspace ${input.workspaceId} not found`);
				}

				const worktree = workspace.worktreeId
					? getWorktree(workspace.worktreeId)
					: null;
				if (!worktree) {
					throw new Error(
						`Worktree for workspace ${input.workspaceId} not found`,
					);
				}

				await resolveReviewThread({
					worktreePath: worktree.path,
					threadId: input.threadId,
					resolve: input.resolve,
				});

				clearGitHubCachesForWorktree(worktree.path);
			}),

		getWorktreeInfo: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => {
				const workspace = getWorkspace(input.workspaceId);
				if (!workspace) {
					return null;
				}

				const worktree = workspace.worktreeId
					? getWorktree(workspace.worktreeId)
					: null;
				if (!worktree) {
					return null;
				}

				const worktreeName = worktree.path.split("/").pop() ?? worktree.branch;
				const branchName = worktree.branch;

				return {
					worktreeName,
					branchName,
					createdAt: worktree.createdAt,
					gitStatus: worktree.gitStatus ?? null,
					githubStatus: worktree.githubStatus ?? null,
				};
			}),

		getWorktreesByProject: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(({ input }) => {
				const projectWorktrees = localDb
					.select()
					.from(worktrees)
					.where(eq(worktrees.projectId, input.projectId))
					.all();

				return projectWorktrees.map((wt) => {
					const workspace = localDb
						.select()
						.from(workspaces)
						.where(
							and(
								eq(workspaces.worktreeId, wt.id),
								isNull(workspaces.deletingAt),
							),
						)
						.get();
					return {
						...wt,
						hasActiveWorkspace: workspace !== undefined,
						existsOnDisk: existsSync(wt.path),
						workspace: workspace ?? null,
					};
				});
			}),

		getExternalWorktrees: publicProcedure
			.input(z.object({ projectId: z.string() }))
			.query(async ({ input }) => {
				const project = getProject(input.projectId);
				if (!project) {
					return [];
				}

				const allWorktrees = await listExternalWorktrees(project.mainRepoPath);

				const trackedWorktrees = localDb
					.select({ path: worktrees.path })
					.from(worktrees)
					.where(eq(worktrees.projectId, input.projectId))
					.all();
				const trackedPaths = new Set(trackedWorktrees.map((wt) => wt.path));

				return allWorktrees
					.filter((wt) => {
						if (wt.path === project.mainRepoPath) return false;
						if (wt.isBare) return false;
						if (wt.isDetached) return false;
						if (!wt.branch) return false;
						if (trackedPaths.has(wt.path)) return false;
						return true;
					})
					.map((wt) => ({
						path: wt.path,
						// biome-ignore lint/style/noNonNullAssertion: filtered above
						branch: wt.branch!,
					}));
			}),
	});
};
