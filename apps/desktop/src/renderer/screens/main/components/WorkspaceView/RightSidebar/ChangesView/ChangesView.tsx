import { toast } from "@superset/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { cn } from "@superset/ui/utils";
import { useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getGitHubStatusQueryPolicy } from "renderer/lib/githubQueryPolicy";
import { useWorkspaceFileEvents } from "renderer/screens/main/components/WorkspaceView/hooks/useWorkspaceFileEvents";
import { useBranchSyncInvalidation } from "renderer/screens/main/hooks/useBranchSyncInvalidation";
import { useGitChangesStatus } from "renderer/screens/main/hooks/useGitChangesStatus";
import { useChangesStore } from "renderer/stores/changes";
import {
	pathsMatch,
	retargetAbsolutePath,
	toAbsoluteWorkspacePath,
} from "shared/absolute-paths";
import type { ChangeCategory, ChangedFile } from "shared/changes-types";
import type { FileSystemChangeEvent } from "shared/file-tree-types";
import { sidebarHeaderTabTriggerClassName } from "../headerTabStyles";
import { ChangesHeader } from "./components/ChangesHeader";
import { CommitInput } from "./components/CommitInput";
import { CommitListVirtualized } from "./components/CommitListVirtualized";
import { FileList } from "./components/FileList";
import { getPRActionState, shouldAutoCreatePRAfterPublish } from "./utils";

interface ChangesViewProps {
	onFileOpen?: (
		file: ChangedFile,
		category: ChangeCategory,
		commitHash?: string,
	) => void;
	isExpandedView?: boolean;
	isActive?: boolean;
}

const INACTIVE_BRANCH_REFETCH_INTERVAL_MS = 10_000;

interface PendingChangesRefresh {
	invalidateBranches: boolean;
	invalidateSelectedFile: boolean;
}

type ChangesTab = "changes" | "commits";

function eventTargetsSelectedFile(
	event: FileSystemChangeEvent,
	selectedAbsolutePath: string | null,
): boolean {
	if (!selectedAbsolutePath) {
		return false;
	}

	if (event.type === "overflow") {
		return true;
	}

	if (event.type === "rename" && event.absolutePath && event.oldAbsolutePath) {
		return (
			retargetAbsolutePath(
				selectedAbsolutePath,
				event.oldAbsolutePath,
				event.absolutePath,
				Boolean(event.isDirectory),
			) !== null
		);
	}

	return event.absolutePath === selectedAbsolutePath;
}

export function ChangesView({
	onFileOpen,
	isExpandedView,
	isActive = true,
}: ChangesViewProps) {
	const { workspaceId } = useParams({ strict: false });
	const trpcUtils = electronTrpc.useUtils();
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: workspaceId ?? "" },
		{ enabled: !!workspaceId },
	);
	const worktreePath = workspace?.worktreePath;
	const projectId = workspace?.projectId;

	const [tab, setTab] = useState<ChangesTab>("changes");

	const githubStatusQueryPolicy = getGitHubStatusQueryPolicy(
		"changes-sidebar",
		{ hasWorkspaceId: !!workspaceId, isActive },
	);

	const { status, isLoading, effectiveBaseBranch, branchData, refetch } =
		useGitChangesStatus({
			worktreePath,
			refetchInterval: isActive ? 2500 : undefined,
			refetchOnWindowFocus: isActive,
			branchRefetchInterval: isActive
				? undefined
				: INACTIVE_BRANCH_REFETCH_INTERVAL_MS,
			branchRefetchOnWindowFocus: true,
		});

	const {
		data: githubStatus,
		isLoading: isGitHubStatusLoading,
		refetch: refetchGithubStatus,
	} = electronTrpc.workspaces.getGitHubStatus.useQuery(
		{ workspaceId: workspaceId ?? "" },
		githubStatusQueryPolicy,
	);

	const discardChangesMutation =
		electronTrpc.changes.discardChanges.useMutation({
			onSuccess: () => refetch(),
			onError: (error, variables) => {
				console.error(
					`Failed to discard changes for ${variables.filePath}:`,
					error,
				);
				toast.error(`Failed to discard changes: ${error.message}`);
			},
		});

	const deleteUntrackedMutation =
		electronTrpc.changes.deleteUntracked.useMutation({
			onSuccess: () => refetch(),
			onError: (error, variables) => {
				console.error(`Failed to delete ${variables.filePath}:`, error);
				toast.error(`Failed to delete file: ${error.message}`);
			},
		});

	const stashMutation = electronTrpc.changes.stash.useMutation({
		onSuccess: () => {
			toast.success("Changes stashed");
			refetch();
		},
		onError: (error) => {
			console.error("Failed to stash:", error);
			toast.error(`Failed to stash: ${error.message}`);
		},
	});

	const stashIncludeUntrackedMutation =
		electronTrpc.changes.stashIncludeUntracked.useMutation({
			onSuccess: () => {
				toast.success("All changes stashed (including untracked)");
				refetch();
			},
			onError: (error) => {
				console.error("Failed to stash:", error);
				toast.error(`Failed to stash: ${error.message}`);
			},
		});

	const stashPopMutation = electronTrpc.changes.stashPop.useMutation({
		onSuccess: () => {
			toast.success("Stash applied and removed");
			refetch();
		},
		onError: (error) => {
			console.error("Failed to pop stash:", error);
			toast.error(`Failed to pop stash: ${error.message}`);
		},
	});

	const activePullRequest = githubStatus?.pr ?? null;
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingRefreshRef = useRef<PendingChangesRefresh>({
		invalidateBranches: false,
		invalidateSelectedFile: false,
	});

	useBranchSyncInvalidation({
		gitBranch: status?.branch ?? branchData?.currentBranch ?? undefined,
		workspaceBranch: workspace?.branch,
		workspaceId: workspaceId ?? "",
	});

	const handleRefresh = () => {
		refetch();
		refetchGithubStatus();
	};

	const handleDiscard = (file: ChangedFile) => {
		if (!worktreePath) return;
		if (file.status === "untracked" || file.status === "added") {
			deleteUntrackedMutation.mutate({ worktreePath, filePath: file.path });
		} else {
			discardChangesMutation.mutate({ worktreePath, filePath: file.path });
		}
	};

	const { fileListViewMode, selectFile, getSelectedFile, setFileListViewMode } =
		useChangesStore();

	const selectedFileState = getSelectedFile(workspaceId || "");
	const selectedFile = selectedFileState?.file ?? null;
	const selectedCommitHash = selectedFileState?.commitHash ?? null;

	const [expandedCommits, setExpandedCommits] = useState<Set<string>>(
		new Set(),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on workspace change
	useEffect(() => {
		setExpandedCommits(new Set());
	}, [worktreePath]);

	useEffect(() => {
		return () => {
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
				refreshTimerRef.current = null;
			}
		};
	}, []);

	useWorkspaceFileEvents(
		workspaceId ?? "",
		(event) => {
			if (!worktreePath) return;

			const selectedAbsolutePath = selectedFileState?.absolutePath ?? null;
			pendingRefreshRef.current.invalidateBranches ||=
				event.type === "overflow";
			pendingRefreshRef.current.invalidateSelectedFile ||=
				eventTargetsSelectedFile(event, selectedAbsolutePath);

			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}

			refreshTimerRef.current = setTimeout(() => {
				refreshTimerRef.current = null;
				const pending = pendingRefreshRef.current;
				pendingRefreshRef.current = {
					invalidateBranches: false,
					invalidateSelectedFile: false,
				};

				const invalidations: Promise<unknown>[] = [
					trpcUtils.changes.getStatus.invalidate({
						worktreePath,
						defaultBranch: effectiveBaseBranch,
					}),
				];

				if (pending.invalidateBranches) {
					invalidations.push(
						trpcUtils.changes.getBranches.invalidate({ worktreePath }),
					);
				}

				if (pending.invalidateSelectedFile && selectedFileState) {
					const oldAbsPath = selectedFileState.file.oldPath
						? toAbsoluteWorkspacePath(
								worktreePath,
								selectedFileState.file.oldPath,
							)
						: undefined;
					invalidations.push(
						trpcUtils.changes.getGitFileContents.invalidate({
							worktreePath,
							absolutePath: selectedFileState.absolutePath,
							oldAbsolutePath: oldAbsPath,
						}),
						trpcUtils.changes.getGitOriginalContent.invalidate({
							worktreePath,
							absolutePath: selectedFileState.absolutePath,
							oldAbsolutePath: oldAbsPath,
						}),
					);
					if (workspaceId) {
						invalidations.push(
							trpcUtils.filesystem.readFile.invalidate({
								workspaceId,
								absolutePath: selectedFileState.absolutePath,
							}),
						);
					}
				}

				Promise.all(invalidations).catch((error) => {
					console.error("[ChangesView] Failed to refresh changes state:", {
						worktreePath,
						error,
					});
				});
			}, 75);
		},
		Boolean(workspaceId && worktreePath),
	);

	// Only load commit files when the commits tab is active
	const expandedCommitHashes = useMemo(
		() =>
			isActive && tab === "commits"
				? Array.from(expandedCommits)
				: ([] as string[]),
		[isActive, tab, expandedCommits],
	);

	const commitFilesQueries = electronTrpc.useQueries((t) =>
		expandedCommitHashes.map((hash) =>
			t.changes.getCommitFiles({
				worktreePath: worktreePath || "",
				commitHash: hash,
			}),
		),
	);

	const commitFilesMap = useMemo(() => {
		const map = new Map<string, ChangedFile[]>();
		expandedCommitHashes.forEach((hash, index) => {
			const query = commitFilesQueries[index];
			if (query?.data) {
				map.set(hash, query.data);
			}
		});
		return map;
	}, [expandedCommitHashes, commitFilesQueries]);

	const stagedFiles = status?.staged ?? [];
	const combinedUnstaged = useMemo(
		() =>
			status?.unstaged && status?.untracked
				? [...status.unstaged, ...status.untracked]
				: [],
		[status?.unstaged, status?.untracked],
	);
	const commits = status?.commits ?? [];

	const hasChanges = stagedFiles.length > 0 || combinedUnstaged.length > 0;

	const commitsWithFiles = commits.map((commit) => ({
		...commit,
		files: commitFilesMap.get(commit.hash) || commit.files,
	}));

	const handleFileSelect = (file: ChangedFile, category: ChangeCategory) => {
		if (!workspaceId || !worktreePath) return;
		selectFile(
			workspaceId,
			toAbsoluteWorkspacePath(worktreePath, file.path),
			file,
			category,
			null,
		);
		onFileOpen?.(file, category);
	};

	const handleCommitFileSelect = (file: ChangedFile, commitHash: string) => {
		if (!workspaceId || !worktreePath) return;
		selectFile(
			workspaceId,
			toAbsoluteWorkspacePath(worktreePath, file.path),
			file,
			"committed",
			commitHash,
		);
		onFileOpen?.(file, "committed", commitHash);
	};

	const handleCommitToggle = (hash: string) => {
		setExpandedCommits((prev) => {
			const next = new Set(prev);
			if (next.has(hash)) {
				next.delete(hash);
			} else {
				next.add(hash);
			}
			return next;
		});
	};

	// Deselect file if it no longer exists in the current change sets
	useEffect(() => {
		if (!workspaceId || !worktreePath || !selectedFileState) {
			return;
		}

		const existsInSelection =
			selectedFileState.category === "staged"
				? stagedFiles.some((file) =>
						pathsMatch(
							toAbsoluteWorkspacePath(worktreePath, file.path),
							selectedFileState.absolutePath,
						),
					)
				: selectedFileState.category === "unstaged"
					? combinedUnstaged.some((file) =>
							pathsMatch(
								toAbsoluteWorkspacePath(worktreePath, file.path),
								selectedFileState.absolutePath,
							),
						)
					: selectedFileState.category === "committed";

		if (!existsInSelection) {
			selectFile(workspaceId, null, null);
		}
	}, [
		combinedUnstaged,
		selectFile,
		selectedFileState,
		stagedFiles,
		workspaceId,
		worktreePath,
	]);

	const defaultBranch =
		branchData?.defaultBranch ?? status?.defaultBranch ?? "";
	const isDefaultBranch = status?.branch === defaultBranch;
	const hasGitHubRepo = !!githubStatus?.repoUrl;
	const hasExistingPR = !!activePullRequest;
	const prActionState = getPRActionState({
		hasRepo: hasGitHubRepo,
		hasExistingPR,
		hasUpstream: status?.hasUpstream ?? false,
		pushCount: status?.pushCount ?? 0,
		pullCount: status?.pullCount ?? 0,
		isDefaultBranch,
	});
	const shouldAutoCreatePR =
		hasGitHubRepo &&
		shouldAutoCreatePRAfterPublish({ hasExistingPR, isDefaultBranch });

	if (!worktreePath) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				No workspace selected
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				Loading changes...
			</div>
		);
	}

	if (!status) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				Unable to load changes
			</div>
		);
	}

	return (
		<div className="flex flex-col flex-1 min-h-0">
			<Tabs
				value={tab}
				onValueChange={(v) => setTab(v as ChangesTab)}
				className="flex flex-1 min-h-0 flex-col gap-0"
			>
				<div className="h-8 shrink-0 border-b bg-background">
					<TabsList className="grid h-full w-full grid-cols-2 items-stretch gap-0 rounded-none bg-transparent p-0">
						<TabsTrigger
							value="changes"
							className={cn(
								sidebarHeaderTabTriggerClassName,
								"min-w-0 w-full justify-center",
							)}
						>
							<span>Changes</span>
						</TabsTrigger>
						<TabsTrigger
							value="commits"
							className={cn(
								sidebarHeaderTabTriggerClassName,
								"min-w-0 w-full justify-center",
							)}
						>
							<span>Commits</span>
							{commits.length > 0 && (
								<span className="text-[11px] text-muted-foreground/60 tabular-nums">
									{commits.length}
								</span>
							)}
						</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent
					value="changes"
					className="mt-0 flex min-h-0 flex-1 flex-col outline-none"
				>
					<ChangesHeader
						onRefresh={handleRefresh}
						viewMode={fileListViewMode}
						onViewModeChange={setFileListViewMode}
						showViewModeToggle
						worktreePath={worktreePath}
						pr={githubStatus?.pr ?? null}
						isPRStatusLoading={isGitHubStatusLoading}
						canCreatePR={prActionState.canCreatePR}
						createPRBlockedReason={prActionState.createPRBlockedReason}
						onStash={() => stashMutation.mutate({ worktreePath })}
						onStashIncludeUntracked={() =>
							stashIncludeUntrackedMutation.mutate({ worktreePath })
						}
						onStashPop={() => stashPopMutation.mutate({ worktreePath })}
						isStashPending={
							stashMutation.isPending ||
							stashIncludeUntrackedMutation.isPending ||
							stashPopMutation.isPending
						}
					/>
					{!hasChanges ? (
						<div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
							No changes detected
						</div>
					) : (
						<div
							className="flex-1 overflow-y-auto"
							data-changes-scroll-container
						>
							<FileList
								files={stagedFiles}
								category="staged"
								viewMode={fileListViewMode}
								selectedFile={selectedFile}
								selectedCommitHash={selectedCommitHash}
								onFileSelect={(file) => handleFileSelect(file, "staged")}
								worktreePath={worktreePath}
								projectId={projectId}
								isExpandedView={isExpandedView}
								onDiscard={handleDiscard}
							/>
							<FileList
								files={combinedUnstaged}
								category="unstaged"
								viewMode={fileListViewMode}
								selectedFile={selectedFile}
								selectedCommitHash={selectedCommitHash}
								onFileSelect={(file) => handleFileSelect(file, "unstaged")}
								worktreePath={worktreePath}
								projectId={projectId}
								isExpandedView={isExpandedView}
								onDiscard={handleDiscard}
							/>
						</div>
					)}
					<div className="shrink-0 border-t border-border">
						<CommitInput
							worktreePath={worktreePath}
							hasStagedChanges={stagedFiles.length > 0}
							pushCount={status.pushCount}
							pullCount={status.pullCount}
							hasUpstream={status.hasUpstream}
							pullRequest={activePullRequest ?? null}
							canCreatePR={prActionState.canCreatePR}
							shouldAutoCreatePRAfterPublish={shouldAutoCreatePR}
							onRefresh={handleRefresh}
						/>
					</div>
				</TabsContent>

				<TabsContent
					value="commits"
					className="mt-0 flex min-h-0 flex-1 flex-col outline-none"
				>
					{commits.length === 0 ? (
						<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
							No commits on this branch
						</div>
					) : (
						<div
							className="flex-1 overflow-y-auto"
							data-changes-scroll-container
						>
							<CommitListVirtualized
								commits={commitsWithFiles}
								expandedCommits={expandedCommits}
								onCommitToggle={handleCommitToggle}
								selectedFile={selectedFile}
								selectedCommitHash={selectedCommitHash}
								onFileSelect={handleCommitFileSelect}
								viewMode={fileListViewMode}
								worktreePath={worktreePath}
								projectId={projectId}
								isExpandedView={isExpandedView}
							/>
						</div>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}
