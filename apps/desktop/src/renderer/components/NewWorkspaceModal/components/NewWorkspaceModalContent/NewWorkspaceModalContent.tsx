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
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoArrowUpRight, GoGitBranch, GoGlobe } from "react-icons/go";
import {
	LuCheck,
	LuChevronDown,
	LuChevronLeft,
	LuFolderGit,
	LuFolderOpen,
	LuHouse,
	LuLock,
	LuPlus,
} from "react-icons/lu";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useOpenProject } from "renderer/react-query/projects";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { ProjectThumbnail } from "renderer/screens/main/components/WorkspaceSidebar/ProjectSection/ProjectThumbnail";
import { sanitizeBranchNameWithMaxLength } from "shared/utils/branch";
import { useNewWorkspaceModalDraft } from "../../NewWorkspaceModalDraftContext";

const COMMAND_CLASS_NAME =
	"[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 flex h-full w-full flex-1 flex-col overflow-hidden rounded-none";

type ModalStep = "project" | "branch" | "new-branch";

interface NewWorkspaceModalContentProps {
	isOpen: boolean;
	preSelectedProjectId: string | null;
	skipProjectStep: boolean;
	onNewProject: () => void;
}

export function NewWorkspaceModalContent({
	isOpen,
	preSelectedProjectId,
	skipProjectStep,
	onNewProject,
}: NewWorkspaceModalContentProps) {
	const navigate = useNavigate();
	const { draft, updateDraft, createWorkspace, closeAndResetDraft } =
		useNewWorkspaceModalDraft();
	const { openNew } = useOpenProject();
	const { data: recentProjects = [], isFetched: areRecentProjectsFetched } =
		electronTrpc.projects.getRecents.useQuery();
	const utils = electronTrpc.useUtils();

	const [step, setStep] = useState<ModalStep>("project");

	useEffect(() => {
		if (!isOpen) {
			setStep("project");
		} else if (skipProjectStep && preSelectedProjectId) {
			setStep("branch");
		}
	}, [isOpen, skipProjectStep, preSelectedProjectId]);

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

	const { data: allWorkspaces = [] } =
		electronTrpc.workspaces.getAll.useQuery();
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

	// new-branch step state
	const [newBranchName, setNewBranchName] = useState("");
	const [parentBranch, setParentBranch] = useState<string>("");
	const [parentPickerOpen, setParentPickerOpen] = useState(false);
	const [parentBranchQuery, setParentBranchQuery] = useState("");

	useEffect(() => {
		if (!isOpen) {
			setBranchQuery("");
			setNewBranchName("");
			setParentBranch("");
			setParentBranchQuery("");
		}
	}, [isOpen]);

	// When entering new-branch step, default parent to defaultBranch
	useEffect(() => {
		if (step === "new-branch" && defaultBranch && !parentBranch) {
			setParentBranch(defaultBranch);
		}
	}, [step, defaultBranch, parentBranch]);

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

	const handleCreateNewBranch = useCallback(() => {
		if (!projectId) return;
		const sanitized = sanitizeBranchNameWithMaxLength(
			newBranchName.trim(),
			undefined,
			{ preserveCase: true },
		);
		if (!sanitized) {
			toast.error("Invalid branch name");
			return;
		}
		const promise = createWorkspace.mutateAsyncWithPendingSetup({
			projectId,
			branchName: sanitized,
			compareBaseBranch: parentBranch || undefined,
			applyPrefix: false,
		});
		toast.promise(promise, {
			loading: `Creating branch "${sanitized}"...`,
			success: "Workspace created",
			error: (err) =>
				err instanceof Error ? err.message : "Failed to create workspace",
		});
		promise
			.then(() => closeAndResetDraft())
			.catch(() => {
				// Keep modal open so the user can retry
			});
	}, [
		projectId,
		newBranchName,
		parentBranch,
		createWorkspace,
		closeAndResetDraft,
	]);

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
			promise
				.then(() => closeAndResetDraft())
				.catch(() => {
					// Keep modal open so the user can retry
				});
		},
		[closeAndResetDraft, createWorkspace, navigate, projectId],
	);

	const handleProjectSelect = (selectedProjectId: string) => {
		updateDraft({ selectedProjectId });
		setStep("branch");
	};

	if (step === "project") {
		return (
			<>
				<div className="flex items-center border-b px-4 py-2.5 shrink-0">
					<span className="text-sm font-medium">New Workspace</span>
				</div>

				<Command className={COMMAND_CLASS_NAME}>
					<CommandInput placeholder="Search repositories..." />
					<CommandList className="!max-h-none flex-1 overflow-y-auto">
						<CommandEmpty>No projects found.</CommandEmpty>
						<CommandGroup>
							{recentProjects
								.filter((p) => Boolean(p.id))
								.map((project) => (
									<CommandItem
										key={project.id}
										value={project.name}
										onSelect={() => handleProjectSelect(project.id)}
										className="h-12"
									>
										<ProjectThumbnail
											projectId={project.id}
											projectName={project.name}
											projectColor={project.color}
											githubOwner={project.githubOwner}
											iconUrl={project.iconUrl}
											iconLetter={project.iconLetter}
											hideImage={project.hideImage ?? false}
										/>
										{project.name}
									</CommandItem>
								))}
						</CommandGroup>
						<CommandSeparator alwaysRender />
						<CommandGroup forceMount>
							<CommandItem
								forceMount
								onSelect={() => {
									void openNew().then((projects) => {
										if (projects.length > 0) {
											handleProjectSelect(projects[0].id);
										}
									});
								}}
							>
								<LuFolderOpen className="size-4" />
								Open project
							</CommandItem>
							<CommandItem forceMount onSelect={onNewProject}>
								<LuFolderGit className="size-4" />
								New project
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</>
		);
	}

	if (step === "new-branch") {
		const filteredParentBranches = parentBranchQuery
			? branches.filter((b) =>
					b.name.toLowerCase().includes(parentBranchQuery.toLowerCase()),
				)
			: branches;

		return (
			<>
				<div className="flex items-center gap-2 border-b px-2 py-2 shrink-0">
					<button
						type="button"
						onClick={() => {
							setStep("branch");
							setNewBranchName("");
							setParentBranch(defaultBranch);
							setParentBranchQuery("");
						}}
						className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					>
						<LuChevronLeft className="size-4" />
					</button>
					<span className="text-sm font-medium truncate">New Branch</span>
				</div>

				<form
					className="flex flex-col gap-4 p-4 flex-1"
					onSubmit={(e) => {
						e.preventDefault();
						handleCreateNewBranch();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="new-branch-name">Branch name</Label>
						<Input
							id="new-branch-name"
							autoFocus
							placeholder="feature/my-branch"
							value={newBranchName}
							onChange={(e) =>
								setNewBranchName(e.target.value.replace(/\s+/g, "-"))
							}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>Parent branch</Label>
						<Popover open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
							<PopoverTrigger asChild>
								<button
									type="button"
									className="flex items-center justify-between gap-2 h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs hover:bg-accent/50 transition-colors"
								>
									<span className="flex items-center gap-2 truncate">
										<GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="font-mono truncate">
											{parentBranch || defaultBranch || "Select branch"}
										</span>
									</span>
									<LuChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
								</button>
							</PopoverTrigger>
							<PopoverContent className="w-72 p-0" align="start">
								<Command shouldFilter={false}>
									<CommandInput
										placeholder="Search branches..."
										value={parentBranchQuery}
										onValueChange={setParentBranchQuery}
									/>
									<CommandList className="max-h-56">
										<CommandEmpty>No branches found.</CommandEmpty>
										<CommandGroup>
											{filteredParentBranches.map((b) => (
												<CommandItem
													key={b.name}
													value={b.name}
													onSelect={() => {
														setParentBranch(b.name);
														setParentPickerOpen(false);
														setParentBranchQuery("");
													}}
													className="flex items-center gap-2"
												>
													<GoGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
													<span className="font-mono truncate flex-1 text-xs">
														{b.name}
													</span>
													{(parentBranch || defaultBranch) === b.name && (
														<LuCheck className="size-3.5 shrink-0" />
													)}
												</CommandItem>
											))}
										</CommandGroup>
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</div>

					<Button
						type="submit"
						disabled={!newBranchName.trim() || createWorkspace.isPending}
						className="w-full mt-auto"
					>
						Create
					</Button>
				</form>
			</>
		);
	}

	return (
		<>
			<div className="flex items-center gap-2 border-b px-2 py-2 shrink-0">
				<button
					type="button"
					onClick={() => setStep("project")}
					className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				>
					<LuChevronLeft className="size-4" />
				</button>
				{selectedProject && (
					<ProjectThumbnail
						projectId={selectedProject.id}
						projectName={selectedProject.name}
						projectColor={selectedProject.color}
						githubOwner={selectedProject.githubOwner}
						iconUrl={selectedProject.iconUrl}
						iconLetter={selectedProject.iconLetter}
						hideImage={selectedProject.hideImage ?? false}
						className="!size-4"
					/>
				)}
				<span className="text-sm font-medium truncate">
					{selectedProject?.name ?? "New Workspace"}
				</span>
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
							{!branchQuery.trim() && (
								<CommandItem
									value="__create_new_branch__"
									onSelect={() => setStep("new-branch")}
									className="group h-12"
								>
									<LuPlus className="size-4 shrink-0 text-muted-foreground" />
									<span className="flex-1">New branch</span>
									<Button
										size="xs"
										className="shrink-0 hidden group-data-[selected=true]:inline-flex"
										onClick={(e) => {
											e.stopPropagation();
											setStep("new-branch");
										}}
									>
										Create ↵
									</Button>
								</CommandItem>
							)}
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
									{branch.checkedOutIn === "main" && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="shrink-0 flex items-center">
													<LuHouse className="size-3.5 text-muted-foreground" />
												</span>
											</TooltipTrigger>
											<TooltipContent>
												This branch is checked out in the main repository — the
												local workspace will be selected
											</TooltipContent>
										</Tooltip>
									)}
									{branch.checkedOutIn === "worktree" &&
										!existingWorkspaceId && (
											<Tooltip>
												<TooltipTrigger asChild>
													<span className="shrink-0 flex items-center">
														<LuLock className="size-3.5 text-muted-foreground" />
													</span>
												</TooltipTrigger>
												<TooltipContent>
													This branch is already checked out in another worktree
												</TooltipContent>
											</Tooltip>
										)}
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
