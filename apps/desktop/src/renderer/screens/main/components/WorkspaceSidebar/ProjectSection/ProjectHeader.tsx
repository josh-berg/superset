import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { HiChevronRight, HiMiniPlus } from "react-icons/hi2";
import {
	LuCaseSensitive,
	LuFolderOpen,
	LuImage,
	LuImageOff,
	LuListPlus,
	LuPalette,
	LuPencil,
	LuSettings,
	LuX,
} from "react-icons/lu";
import { ColorSelector } from "renderer/components/ColorSelector";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useUpdateProject } from "renderer/react-query/projects/useUpdateProject";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { useProjectRename } from "renderer/screens/main/hooks/useProjectRename";
import { STROKE_WIDTH } from "../constants";
import { RenameInput } from "../RenameInput";
import { RunningTabCounts } from "../RunningTabCounts";
import { CloseProjectDialog } from "./CloseProjectDialog";
import { ProjectThumbnail } from "./ProjectThumbnail";
import { SetAbbreviationDialog } from "./SetAbbreviationDialog";

interface ProjectHeaderProps {
	projectId: string;
	projectName: string;
	projectColor: string;
	githubOwner: string | null;
	mainRepoPath: string;
	hideImage: boolean;
	iconUrl: string | null;
	iconLetter: string | null;
	isGitless: boolean;
	isFeatureProject?: boolean;
	/** Whether the project section is collapsed (workspaces hidden) */
	isCollapsed: boolean;
	/** Whether the sidebar is in collapsed mode (icon-only view) */
	isSidebarCollapsed?: boolean;
	onToggleCollapse: () => void;
	workspaceCount: number;
	/** All workspace ids in this project, for aggregate running-tab counts. */
	workspaceIds: string[];
	/**
	 * Git-backed workspace ids to monitor for an aggregate "needs pull" badge.
	 * For feature projects these are the child repo workspaces; for single-repo
	 * projects they are the project's own workspaces.
	 */
	gitWorkspaceIds: string[];
	onNewWorkspace: () => void;
}

export function ProjectHeader({
	projectId,
	projectName,
	projectColor,
	githubOwner,
	mainRepoPath,
	hideImage,
	iconUrl,
	iconLetter,
	isGitless,
	isFeatureProject = false,
	isCollapsed,
	isSidebarCollapsed = false,
	onToggleCollapse,
	workspaceCount,
	workspaceIds,
	gitWorkspaceIds,
	onNewWorkspace,
}: ProjectHeaderProps) {
	const utils = electronTrpc.useUtils();

	// Show the aggregate badge for feature projects always, and for single-repo
	// projects only while collapsed (expanded, the per-workspace rows show it).
	const behindBadgeEnabled =
		gitWorkspaceIds.length > 0 && (isFeatureProject || isCollapsed);
	const { data: aheadBehindBatch } =
		electronTrpc.workspaces.getAheadBehindBatch.useQuery(
			{ workspaceIds: gitWorkspaceIds },
			{ enabled: behindBadgeEnabled },
		);
	const reposBehind = aheadBehindBatch
		? Object.values(aheadBehindBatch).filter((c) => c.behind > 0).length
		: 0;
	const showBehindBadge = behindBadgeEnabled && reposBehind > 0;
	const navigate = useNavigate();
	const params = useParams({ strict: false }) as { workspaceId?: string };
	const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
	const [isAbbreviationDialogOpen, setIsAbbreviationDialogOpen] =
		useState(false);
	const rename = useProjectRename(projectId, projectName);

	const closeProject = electronTrpc.projects.close.useMutation({
		onMutate: async ({ id }) => {
			let shouldNavigate = false;

			if (params.workspaceId) {
				try {
					const currentWorkspace = await utils.workspaces.get.fetch({
						id: params.workspaceId,
					});
					shouldNavigate = currentWorkspace?.projectId === id;
				} catch (error) {
					console.warn(
						"[ProjectHeader] Failed to resolve current workspace before closing project",
						error,
					);
				}
			}

			return { shouldNavigate };
		},
		onSuccess: async (data, { id }, context) => {
			utils.workspaces.getAllGrouped.invalidate();
			utils.projects.getRecents.invalidate();

			if (context?.shouldNavigate) {
				const groups = await utils.workspaces.getAllGrouped.fetch();
				const otherWorkspace = groups
					.flatMap((group) => group.workspaces)
					.find((w) => w.projectId !== id);

				if (otherWorkspace) {
					navigateToWorkspace(otherWorkspace.id, navigate);
				} else {
					navigate({ to: "/workspace" });
				}
			}

			if (data.terminalWarning) {
				toast.warning(data.terminalWarning);
			}
		},
		onError: (error) => {
			toast.error(`Failed to close project: ${error.message}`);
		},
	});

	const openInFinder = electronTrpc.external.openInFinder.useMutation({
		onError: (error) => toast.error(`Failed to open: ${error.message}`),
	});

	const handleCloseProject = () => {
		setIsCloseDialogOpen(true);
	};

	const handleConfirmClose = ({
		deleteFromDisk,
	}: {
		deleteFromDisk: boolean;
	}) => {
		closeProject.mutate({ id: projectId, deleteFromDisk });
	};

	const handleOpenInFinder = () => {
		openInFinder.mutate(mainRepoPath);
	};

	const handleOpenSettings = () => {
		navigate({ to: "/settings/project/$projectId", params: { projectId } });
	};

	const updateProject = useUpdateProject({
		onError: (error) => toast.error(`Failed to update color: ${error.message}`),
	});

	const handleColorChange = (color: string) => {
		updateProject.mutate({ id: projectId, patch: { color } });
	};

	const handleToggleImage = () => {
		updateProject.mutate({ id: projectId, patch: { hideImage: !hideImage } });
	};

	const handleSetAbbreviation = (abbreviation: string | null) => {
		updateProject.mutate({
			id: projectId,
			patch: { iconLetter: abbreviation },
		});
	};

	const createSection = electronTrpc.workspaces.createSection.useMutation({
		onSuccess: () => utils.workspaces.getAllGrouped.invalidate(),
		onError: (error) =>
			toast.error(`Failed to create section: ${error.message}`),
	});

	const handleNewSection = () => {
		createSection.mutate({ projectId, name: "New Section" });
	};

	const colorPickerSubmenu = (
		<ContextMenuSub>
			<ContextMenuSubTrigger>
				<LuPalette className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
				Set Color
			</ContextMenuSubTrigger>
			<ContextMenuSubContent className="w-40 max-h-80 overflow-y-auto">
				<ColorSelector
					variant="menu"
					selectedColor={projectColor}
					onSelectColor={handleColorChange}
				/>
			</ContextMenuSubContent>
		</ContextMenuSub>
	);

	const abbreviationMenuItem = (
		<ContextMenuItem onSelect={() => setIsAbbreviationDialogOpen(true)}>
			<LuCaseSensitive className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
			Set Abbreviation
		</ContextMenuItem>
	);

	if (isSidebarCollapsed) {
		return (
			<>
				<ContextMenu>
					<Tooltip delayDuration={300}>
						<ContextMenuTrigger asChild>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={onToggleCollapse}
									className={cn(
										"relative flex items-center justify-center size-8 rounded-md",
										"hover:bg-muted/50 transition-colors",
									)}
								>
									<ProjectThumbnail
										projectId={projectId}
										projectName={projectName}
										projectColor={projectColor}
										githubOwner={githubOwner}
										iconUrl={iconUrl}
										iconLetter={iconLetter}
										hideImage={hideImage}
										isFeatureProject={isFeatureProject}
									/>
									{showBehindBadge && (
										<span className="absolute top-0 right-0 size-2 rounded-full bg-amber-400 ring-2 ring-background" />
									)}
								</button>
							</TooltipTrigger>
						</ContextMenuTrigger>
						<TooltipContent className="flex flex-col gap-0.5">
							<span className="font-medium">{projectName}</span>
							<span className="text-xs text-muted-foreground">
								{workspaceCount} workspace{workspaceCount !== 1 ? "s" : ""}
							</span>
							{showBehindBadge && (
								<span className="text-xs text-amber-400">
									{reposBehind} {isFeatureProject ? "repo" : "workspace"}
									{reposBehind === 1 ? "" : "s"} behind remote
								</span>
							)}
							<RunningTabCounts workspaceIds={workspaceIds} />
						</TooltipContent>
					</Tooltip>
					<ContextMenuContent>
						<ContextMenuItem onSelect={rename.startRename}>
							<LuPencil className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
							Rename
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem onSelect={handleOpenInFinder}>
							<LuFolderOpen
								className="size-4 mr-2"
								strokeWidth={STROKE_WIDTH}
							/>
							Open in Finder
						</ContextMenuItem>
						<ContextMenuItem onSelect={handleOpenSettings}>
							<LuSettings className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
							Project Settings
						</ContextMenuItem>
						{colorPickerSubmenu}
						{abbreviationMenuItem}
						<ContextMenuItem onSelect={handleNewSection}>
							<LuListPlus className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
							New Section
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							onSelect={handleCloseProject}
							disabled={closeProject.isPending}
							className="text-destructive focus:text-destructive"
						>
							<LuX
								className="size-4 mr-2 text-destructive"
								strokeWidth={STROKE_WIDTH}
							/>
							{closeProject.isPending ? "Closing..." : "Close Project"}
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>

				<CloseProjectDialog
					projectId={projectId}
					projectName={projectName}
					workspaceCount={workspaceCount}
					mainRepoPath={mainRepoPath}
					isGitless={isGitless}
					isFeatureProject={isFeatureProject}
					open={isCloseDialogOpen}
					onOpenChange={setIsCloseDialogOpen}
					onConfirm={handleConfirmClose}
				/>
				<SetAbbreviationDialog
					open={isAbbreviationDialogOpen}
					onOpenChange={setIsAbbreviationDialogOpen}
					currentAbbreviation={iconLetter}
					onSetAbbreviation={handleSetAbbreviation}
				/>
			</>
		);
	}

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						className={cn(
							"flex items-center w-full pl-3 pr-2 py-1.5 text-sm font-medium",
							"hover:bg-muted/50 transition-colors",
						)}
					>
						{rename.isRenaming ? (
							<div className="flex items-center gap-2 flex-1 min-w-0 py-0.5">
								<ProjectThumbnail
									projectId={projectId}
									projectName={projectName}
									projectColor={projectColor}
									githubOwner={githubOwner}
									hideImage={hideImage}
									iconUrl={iconUrl}
									iconLetter={iconLetter}
									isFeatureProject={isFeatureProject}
								/>
								<RenameInput
									value={rename.renameValue}
									onChange={rename.setRenameValue}
									onSubmit={rename.submitRename}
									onCancel={rename.cancelRename}
									className="h-6 px-1 py-0 text-sm -ml-1 font-medium bg-transparent border-none outline-none flex-1 min-w-0"
								/>
							</div>
						) : (
							<button
								type="button"
								onClick={onToggleCollapse}
								onDoubleClick={rename.startRename}
								className="flex items-center gap-2 flex-1 min-w-0 py-0.5 text-left cursor-pointer"
							>
								<ProjectThumbnail
									projectId={projectId}
									projectName={projectName}
									projectColor={projectColor}
									githubOwner={githubOwner}
									hideImage={hideImage}
									iconUrl={iconUrl}
									iconLetter={iconLetter}
									isFeatureProject={isFeatureProject}
								/>
								<span className="truncate">{projectName}</span>
								<span className="text-xs text-muted-foreground tabular-nums font-normal">
									({workspaceCount})
								</span>
							</button>
						)}

						{showBehindBadge && (
							<Tooltip delayDuration={300}>
								<TooltipTrigger asChild>
									<span className="flex items-center gap-1 ml-1 text-[11px] font-mono text-amber-400/75 tabular-nums shrink-0">
										<span className="size-1.5 rounded-full bg-amber-400/75" />
										{reposBehind}
									</span>
								</TooltipTrigger>
								<TooltipContent side="bottom" sideOffset={4}>
									{reposBehind} {isFeatureProject ? "repo" : "workspace"}
									{reposBehind === 1 ? "" : "s"} behind remote
								</TooltipContent>
							</Tooltip>
						)}

						<RunningTabCounts workspaceIds={workspaceIds} className="ml-1" />

						{!isGitless && (
							<Tooltip delayDuration={500}>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onNewWorkspace();
										}}
										onContextMenu={(e) => e.stopPropagation()}
										className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
									>
										<HiMiniPlus className="size-4 text-muted-foreground" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom" sideOffset={4}>
									New workspace
								</TooltipContent>
							</Tooltip>
						)}

						<button
							type="button"
							onClick={onToggleCollapse}
							onContextMenu={(e) => e.stopPropagation()}
							aria-expanded={!isCollapsed}
							className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
						>
							<HiChevronRight
								className={cn(
									"size-3.5 text-muted-foreground transition-transform duration-150",
									!isCollapsed && "rotate-90",
								)}
							/>
						</button>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onSelect={rename.startRename}>
						<LuPencil className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						Rename
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={handleOpenInFinder}>
						<LuFolderOpen className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						Open in Finder
					</ContextMenuItem>
					<ContextMenuItem onSelect={handleOpenSettings}>
						<LuSettings className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						Project Settings
					</ContextMenuItem>
					{colorPickerSubmenu}
					{abbreviationMenuItem}
					<ContextMenuItem onSelect={handleToggleImage}>
						{hideImage ? (
							<LuImage className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						) : (
							<LuImageOff className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						)}
						{hideImage ? "Show Image" : "Hide Image"}
					</ContextMenuItem>
					<ContextMenuItem onSelect={handleNewSection}>
						<LuListPlus className="size-4 mr-2" strokeWidth={STROKE_WIDTH} />
						New Section
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						onSelect={handleCloseProject}
						disabled={closeProject.isPending}
						className="text-destructive focus:text-destructive"
					>
						<LuX
							className="size-4 mr-2 text-destructive"
							strokeWidth={STROKE_WIDTH}
						/>
						{closeProject.isPending ? "Closing..." : "Close Project"}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<CloseProjectDialog
				projectId={projectId}
				projectName={projectName}
				workspaceCount={workspaceCount}
				mainRepoPath={mainRepoPath}
				isGitless={isGitless}
				isFeatureProject={isFeatureProject}
				open={isCloseDialogOpen}
				onOpenChange={setIsCloseDialogOpen}
				onConfirm={handleConfirmClose}
			/>
			<SetAbbreviationDialog
				open={isAbbreviationDialogOpen}
				onOpenChange={setIsAbbreviationDialogOpen}
				currentAbbreviation={iconLetter}
				onSetAbbreviation={handleSetAbbreviation}
			/>
		</>
	);
}
