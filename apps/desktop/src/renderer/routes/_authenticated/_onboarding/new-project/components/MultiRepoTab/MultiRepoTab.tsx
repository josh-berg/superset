import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	LuCheck,
	LuCloud,
	LuHardDrive,
	LuLoader,
	LuPlus,
} from "react-icons/lu";
import type { RepoSelection } from "renderer/components/RepoPicker";
import { RepoPicker } from "renderer/components/RepoPicker";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";

export type MultiRepoStep = "configure" | "select-repos" | "creating";

interface MultiRepoTabProps {
	onError: (error: string) => void;
	onCreatingChange?: (isCreating: boolean) => void;
	onStepChange?: (step: MultiRepoStep) => void;
	parentDir: string;
	disabled?: boolean;
}

export function MultiRepoTab({
	onError,
	onCreatingChange,
	onStepChange,
	parentDir,
	disabled,
}: MultiRepoTabProps) {
	const navigate = useNavigate();
	const utils = electronTrpc.useUtils();

	const [step, setStep] = useState<MultiRepoStep>("configure");
	const [projectName, setProjectName] = useState("");
	const [branchName, setBranchName] = useState("");
	const [selectedRepos, setSelectedRepos] = useState<RepoSelection[]>([]);
	const [addingRepoIndex, setAddingRepoIndex] = useState<number | null>(null);
	const [creationDone, setCreationDone] = useState(false);

	const createFeatureProject =
		electronTrpc.featureProjects.create.useMutation();
	const addRepo = electronTrpc.featureProjects.addRepo.useMutation();

	const localCloneAvailability =
		electronTrpc.featureProjects.getLocalCloneAvailability.useQuery(
			{ repoNames: selectedRepos.map((r) => r.name) },
			{ enabled: selectedRepos.length > 0 },
		);

	const isRepoSelected = (fullName: string) =>
		selectedRepos.some((r) => r.fullName === fullName);

	const toggleRepo = (repo: {
		fullName: string;
		name: string;
		description: string | null;
		isPrivate: boolean;
	}) => {
		if (isRepoSelected(repo.fullName)) {
			setSelectedRepos((prev) =>
				prev.filter((r) => r.fullName !== repo.fullName),
			);
		} else {
			setSelectedRepos((prev) => [...prev, { ...repo, parentBranch: "" }]);
		}
	};

	const updateParentBranch = (fullName: string, value: string) => {
		setSelectedRepos((prev) =>
			prev.map((r) =>
				r.fullName === fullName ? { ...r, parentBranch: value } : r,
			),
		);
	};

	/** Merge a saved group's repos into the current selection, skipping dupes. */
	const applyGroup = (repos: string[]) => {
		setSelectedRepos((prev) => {
			const existing = new Set(prev.map((r) => r.fullName));
			const additions = repos
				.filter((fullName) => !existing.has(fullName))
				.map((fullName) => ({
					fullName,
					name: fullName.split("/")[1] ?? fullName,
					description: null,
					isPrivate: false,
					parentBranch: "",
				}));
			return [...prev, ...additions];
		});
	};

	const handleConfigure = () => {
		if (!projectName.trim()) {
			onError("Please enter a project name");
			return;
		}
		if (!parentDir.trim()) {
			onError("Please select a project location");
			return;
		}
		setStep("select-repos");
		onStepChange?.("select-repos");
	};

	const handleCreate = async () => {
		if (selectedRepos.length === 0) {
			onError("Please select at least one repository");
			return;
		}

		setStep("creating");
		onStepChange?.("creating");
		onCreatingChange?.(true);

		const added: string[] = [];

		try {
			const { project, workspaceId } = await createFeatureProject.mutateAsync({
				name: projectName.trim(),
				parentDir: parentDir.trim(),
			});

			for (let i = 0; i < selectedRepos.length; i++) {
				setAddingRepoIndex(i);
				const repo = selectedRepos[i];
				await addRepo.mutateAsync({
					featureProjectId: project.id,
					repoFullName: repo.fullName,
					branchName: branchName.trim() || undefined,
					parentBranch: repo.parentBranch.trim() || undefined,
				});
				added.push(repo.fullName);
			}

			setAddingRepoIndex(null);
			setCreationDone(true);

			await utils.workspaces.getAllGrouped.invalidate();
			await utils.projects.getRecents.invalidate();

			setTimeout(() => {
				if (workspaceId) {
					navigateToWorkspace(workspaceId, navigate, { replace: true });
				} else {
					navigate({
						to: "/project/$projectId",
						params: { projectId: project.id },
						replace: true,
					});
				}
			}, 800);
		} catch (err) {
			// Drop repos that cloned successfully so a retry only attempts the remainder.
			setSelectedRepos((prev) =>
				prev.filter((r) => !added.includes(r.fullName)),
			);
			setStep("select-repos");
			onStepChange?.("select-repos");
			setAddingRepoIndex(null);
			onCreatingChange?.(false);
			onError(err instanceof Error ? err.message : "Failed to create project");
		}
	};

	if (step === "creating") {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-3">
					{selectedRepos.map((repo, i) => {
						const isDone =
							addingRepoIndex !== null ? i < addingRepoIndex : creationDone;
						const isCurrent = addingRepoIndex === i;
						const isLocal = localCloneAvailability.data?.[repo.name] ?? false;

						return (
							<div
								key={repo.fullName}
								className="flex items-center gap-3 text-sm"
							>
								<div className="size-5 flex items-center justify-center">
									{isDone || creationDone ? (
										<LuCheck className="size-4 text-green-500" />
									) : isCurrent ? (
										<LuLoader className="size-4 animate-spin text-primary" />
									) : (
										<div className="size-2 rounded-full bg-muted-foreground/30" />
									)}
								</div>
								<span
									className={
										isDone || creationDone
											? "text-foreground"
											: isCurrent
												? "text-foreground"
												: "text-muted-foreground"
									}
								>
									{repo.name}
								</span>
								{(isCurrent || isDone || creationDone) && (
									<span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
										{branchName.trim() && <span>{branchName}</span>}
										<Tooltip>
											<TooltipTrigger asChild>
												<span>
													{isLocal ? (
														<LuHardDrive className="size-3.5" />
													) : (
														<LuCloud className="size-3.5" />
													)}
												</span>
											</TooltipTrigger>
											<TooltipContent>
												{isLocal ? "Local clone" : "Remote clone"}
											</TooltipContent>
										</Tooltip>
									</span>
								)}
							</div>
						);
					})}
				</div>
			</div>
		);
	}

	if (step === "select-repos") {
		return (
			<div className="flex flex-col gap-5">
				<RepoPicker
					selectedRepos={selectedRepos}
					onToggleRepo={toggleRepo}
					onUpdateParentBranch={updateParentBranch}
					onRemoveRepo={(fullName) =>
						setSelectedRepos((prev) =>
							prev.filter((r) => r.fullName !== fullName),
						)
					}
					onApplyGroup={applyGroup}
					onError={onError}
				/>

				<div className="flex justify-between pt-2 border-t border-border/40">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setStep("configure");
							onStepChange?.("configure");
						}}
					>
						Back
					</Button>
					<Button
						size="sm"
						onClick={handleCreate}
						disabled={selectedRepos.length === 0}
					>
						<LuPlus className="size-4 mr-1" />
						Create project ({selectedRepos.length} repos)
					</Button>
				</div>
			</div>
		);
	}

	// Step: configure
	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="feature-project-name"
					className="text-sm font-medium text-foreground"
				>
					Project name
				</label>
				<Input
					id="feature-project-name"
					value={projectName}
					onChange={(e) => setProjectName(e.target.value)}
					placeholder="my-feature"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Enter") handleConfigure();
					}}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center gap-1.5">
					<label
						htmlFor="feature-branch-name"
						className="text-sm font-medium text-foreground"
					>
						Feature branch name
					</label>
					<span className="text-xs text-muted-foreground">(optional)</span>
				</div>
				<Input
					id="feature-branch-name"
					value={branchName}
					onChange={(e) => setBranchName(e.target.value)}
					placeholder="feature/my-feature"
					onKeyDown={(e) => {
						if (e.key === "Enter") handleConfigure();
					}}
				/>
				<p className="text-xs text-muted-foreground">
					Leave blank to stay on the default branch in each repo.
				</p>
			</div>
			<div className="flex justify-end pt-2 border-t border-border/40">
				<Button size="sm" onClick={handleConfigure} disabled={disabled}>
					Next: Select repos
				</Button>
			</div>
		</div>
	);
}
