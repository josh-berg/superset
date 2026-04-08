import { Button } from "@superset/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@superset/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { useNavigate } from "@tanstack/react-router";
import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoArrowUpRight, GoGitBranch, GoGlobe } from "react-icons/go";
import { HiCheck, HiChevronUpDown } from "react-icons/hi2";
import { LuFolderGit, LuFolderOpen } from "react-icons/lu";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { ProjectThumbnail } from "renderer/screens/main/components/WorkspaceSidebar/ProjectSection/ProjectThumbnail";
import { useNewWorkspaceModalDraft } from "../../NewWorkspaceModalDraftContext";

const COMMAND_CLASS_NAME =
	"[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 flex h-full w-full flex-1 flex-col overflow-hidden rounded-none";

interface NewWorkspaceModalContentProps {
	isOpen: boolean;
	preSelectedProjectId: string | null;
	onImportRepo: () => Promise<void>;
	onNewProject: () => void;
}

export function NewWorkspaceModalContent({
	isOpen,
	preSelectedProjectId,
	onImportRepo,
	onNewProject,
}: NewWorkspaceModalContentProps) {
	const navigate = useNavigate();
	const { draft, updateDraft, createWorkspace, closeAndResetDraft } =
		useNewWorkspaceModalDraft();
	const { data: recentProjects = [], isFetched: areRecentProjectsFetched } =
		electronTrpc.projects.getRecents.useQuery();
	const utils = electronTrpc.useUtils();

	useEffect(() => {
		if (!isOpen) return;
		void utils.projects.getBranches.invalidate();
		void utils.projects.getBranchesLocal.invalidate();
	}, [isOpen, utils]);

	const appliedPreSelectionRef = useRef<string | null>(null);

	useEffect(() => {
		if (!isOpen) {
			appliedPreSelectionRef.current = null;
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;

		if (
			preSelectedProjectId &&
			preSelectedProjectId !== appliedPreSelectionRef.current
		) {
			if (!areRecentProjectsFetched) return;
			const hasPreSelectedProject = recentProjects.some(
				(project) => project.id === preSelectedProjectId,
			);
			if (hasPreSelectedProject) {
				appliedPreSelectionRef.current = preSelectedProjectId;
				if (preSelectedProjectId !== draft.selectedProjectId) {
					updateDraft({ selectedProjectId: preSelectedProjectId });
				}
				return;
			}
		}

		if (!areRecentProjectsFetched) return;

		const hasSelectedProject = recentProjects.some(
			(project) => project.id === draft.selectedProjectId,
		);
		if (!hasSelectedProject) {
			updateDraft({ selectedProjectId: recentProjects[0]?.id ?? null });
		}
	}, [
		draft.selectedProjectId,
		areRecentProjectsFetched,
		isOpen,
		preSelectedProjectId,
		recentProjects,
		updateDraft,
	]);

	const selectedProject = recentProjects.find(
		(project) => project.id === draft.selectedProjectId,
	);

	const projectId = draft.selectedProjectId;

	const { data: localBranchData, isLoading: isLocalLoading } =
		electronTrpc.projects.getBranchesLocal.useQuery(
			{ projectId: projectId ?? "" },
			{ enabled: !!projectId },
		);
	const { data: remoteBranchData } = electronTrpc.projects.getBranches.useQuery(
		{ projectId: projectId ?? "" },
		{ enabled: !!projectId },
	);
	const branchData = remoteBranchData ?? localBranchData;

	const { data: allWorkspaces = [] } = electronTrpc.workspaces.getAll.useQuery();
	const activeWorkspacesByBranch = useMemo(() => {
		const map = new Map<string, string>();
		for (const ws of allWorkspaces) {
			if (ws.projectId === projectId && !ws.deletingAt) {
				map.set(ws.branch, ws.id);
			}
		}
		return map;
	}, [allWorkspaces, projectId]);

	const defaultBranch = branchData?.defaultBranch ?? "main";
	const branches = useMemo(
		() =>
			(branchData?.branches ?? []).sort((a, b) => {
				if (a.name === defaultBranch) return -1;
				if (b.name === defaultBranch) return 1;
				if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
				return a.name.localeCompare(b.name);
			}),
		[branchData?.branches, defaultBranch],
	);

	const branchRows = useMemo(
		() =>
			branches.map((branch) => ({
				branch,
				existingWorkspaceId: activeWorkspacesByBranch.get(branch.name),
			})),
		[branches, activeWorkspacesByBranch],
	);

	const [branchQuery, setBranchQuery] = useState("");
	const debouncedQuery = useDebouncedValue(branchQuery, 150);

	useEffect(() => {
		if (!isOpen) setBranchQuery("");
	}, [isOpen]);

	const branchFuse = useMemo(
		() =>
			new Fuse(branchRows, {
				keys: ["branch.name"],
				threshold: 0.3,
				includeScore: true,
				ignoreLocation: true,
			}),
		[branchRows],
	);

	const visibleBranchRows = useMemo(() => {
		const query = debouncedQuery.trim();
		if (!query) return branchRows.slice(0, 100);
		return branchFuse
			.search(query)
			.slice(0, 100)
			.map((r) => r.item);
	}, [debouncedQuery, branchRows, branchFuse]);

	const handleBranchAction = useCallback(
		(branchName: string, existingWorkspaceId: string | undefined) => {
			if (!projectId) return;

			if (existingWorkspaceId) {
				closeAndResetDraft();
				navigateToWorkspace(existingWorkspaceId, navigate, { replace: true });
				return;
			}

			const promise = createWorkspace.mutateAsyncWithPendingSetup({
				projectId,
				branchName,
				useExistingBranch: true,
				applyPrefix: false,
			});
			toast.promise(promise, {
				loading: "Creating workspace...",
				success: "Workspace created",
				error: (err) =>
					err instanceof Error ? err.message : "Failed to create workspace",
			});
			promise.then(() => closeAndResetDraft()).catch(() => {
				// Keep modal open so the user can retry
			});
		},
		[closeAndResetDraft, createWorkspace, navigate, projectId],
	);

	const [projectPickerOpen, setProjectPickerOpen] = useState(false);

	return (
		<>
			<div className="flex items-center justify-between border-b px-4 py-2.5 shrink-0">
				<span className="text-sm font-medium">New Workspace</span>
				<Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
					<PopoverTrigger asChild>
						<Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
							{selectedProject && (
								<ProjectThumbnail
									projectId={selectedProject.id}
									projectName={selectedProject.name}
									projectColor={selectedProject.color}
									githubOwner={selectedProject.githubOwner}
									iconUrl={selectedProject.iconUrl}
									hideImage={selectedProject.hideImage ?? false}
									className="!size-4"
								/>
							)}
							<span className="truncate max-w-[140px]">
								{selectedProject?.name ?? "Select project"}
							</span>
							<HiChevronUpDown className="size-3" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" className="w-60 p-0">
						<Command>
							<CommandInput placeholder="Search projects..." />
							<CommandList className="max-h-72">
								<CommandEmpty>No projects found.</CommandEmpty>
								<CommandGroup>
									{recentProjects
										.filter((p) => Boolean(p.id))
										.map((project) => (
											<CommandItem
												key={project.id}
												value={project.name}
												onSelect={() => {
													updateDraft({ selectedProjectId: project.id });
													setProjectPickerOpen(false);
												}}
											>
												<ProjectThumbnail
													projectId={project.id}
													projectName={project.name}
													projectColor={project.color}
													githubOwner={project.githubOwner}
													iconUrl={project.iconUrl}
													hideImage={project.hideImage ?? false}
												/>
												{project.name}
												{project.id === selectedProject?.id && (
													<HiCheck className="ml-auto size-4" />
												)}
											</CommandItem>
										))}
								</CommandGroup>
								<CommandSeparator alwaysRender />
								<CommandGroup forceMount>
									<CommandItem
										forceMount
										onSelect={() => {
											setProjectPickerOpen(false);
											void onImportRepo();
										}}
									>
										<LuFolderOpen className="size-4" />
										Open project
									</CommandItem>
									<CommandItem
										forceMount
										onSelect={() => {
											setProjectPickerOpen(false);
											onNewProject();
										}}
									>
										<LuFolderGit className="size-4" />
										New project
									</CommandItem>
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>

			<Command shouldFilter={false} className={COMMAND_CLASS_NAME}>
				<CommandInput
					value={branchQuery}
					onValueChange={setBranchQuery}
					placeholder="Search branches..."
				/>
				<CommandList className="!max-h-none flex-1 overflow-y-auto">
					{!projectId ? (
						<CommandGroup>
							<CommandEmpty>Select a project to view branches.</CommandEmpty>
						</CommandGroup>
					) : isLocalLoading ? (
						<CommandGroup>
							<CommandEmpty>Loading branches...</CommandEmpty>
						</CommandGroup>
					) : (
						<CommandGroup>
							<CommandEmpty>No branches found.</CommandEmpty>
							{visibleBranchRows.map(({ branch, existingWorkspaceId }) => (
								<CommandItem
									key={branch.name}
									onSelect={() =>
										handleBranchAction(branch.name, existingWorkspaceId)
									}
									className="group h-12"
								>
									{existingWorkspaceId ? (
										<GoArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
									) : branch.isLocal ? (
										<GoGitBranch className="size-4 shrink-0 text-muted-foreground" />
									) : (
										<GoGlobe className="size-4 shrink-0 text-muted-foreground" />
									)}
									<span className="truncate flex-1">{branch.name}</span>
									<Button
										size="xs"
										className="shrink-0 hidden group-data-[selected=true]:inline-flex"
										onClick={(e) => {
											e.stopPropagation();
											handleBranchAction(branch.name, existingWorkspaceId);
										}}
									>
										{existingWorkspaceId ? "Open" : "Create"} ↵
									</Button>
								</CommandItem>
							))}
						</CommandGroup>
					)}
				</CommandList>
			</Command>
		</>
	);
}
