import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useState } from "react";
import { LuCheck, LuCloud, LuHardDrive, LuLoader } from "react-icons/lu";
import type { RepoSelection } from "renderer/components/RepoPicker";
import { RepoPicker } from "renderer/components/RepoPicker";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface AddRepoDialogProps {
	featureProjectId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function AddRepoDialog({
	featureProjectId,
	open,
	onOpenChange,
}: AddRepoDialogProps) {
	const utils = electronTrpc.useUtils();

	const [branchName, setBranchName] = useState("");
	const [selectedRepos, setSelectedRepos] = useState<RepoSelection[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [addingRepoIndex, setAddingRepoIndex] = useState<number | null>(null);

	const addRepo = electronTrpc.featureProjects.addRepo.useMutation();

	const localCloneAvailability =
		electronTrpc.featureProjects.getLocalCloneAvailability.useQuery(
			{ repoNames: selectedRepos.map((r) => r.name) },
			{ enabled: selectedRepos.length > 0 },
		);

	const resetState = () => {
		setBranchName("");
		setSelectedRepos([]);
		setAddingRepoIndex(null);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && !isSubmitting) resetState();
		onOpenChange(nextOpen);
	};

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

	const handleSubmit = async () => {
		if (selectedRepos.length === 0) return;

		setIsSubmitting(true);
		const added: string[] = [];

		try {
			for (let i = 0; i < selectedRepos.length; i++) {
				setAddingRepoIndex(i);
				const repo = selectedRepos[i];
				await addRepo.mutateAsync({
					featureProjectId,
					repoFullName: repo.fullName,
					branchName: branchName.trim() || undefined,
					parentBranch: repo.parentBranch.trim() || undefined,
				});
				added.push(repo.fullName);
			}

			await utils.workspaces.getAllGrouped.invalidate();
			resetState();
			onOpenChange(false);
		} catch (err) {
			// Drop repos that were already added so a retry doesn't re-clone them.
			setSelectedRepos((prev) =>
				prev.filter((r) => !added.includes(r.fullName)),
			);
			toast.error(err instanceof Error ? err.message : "Failed to add repo");
		} finally {
			setIsSubmitting(false);
			setAddingRepoIndex(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[480px] max-h-[85vh] flex flex-col gap-0 p-0">
				<DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
					<DialogTitle className="text-sm font-medium">
						Add repo to project
					</DialogTitle>
				</DialogHeader>

				{isSubmitting ? (
					<div className="flex flex-col gap-3 px-4 py-4">
						{selectedRepos.map((repo, i) => {
							const isDone = addingRepoIndex !== null && i < addingRepoIndex;
							const isCurrent = addingRepoIndex === i;
							const isLocal = localCloneAvailability.data?.[repo.name] ?? false;

							return (
								<div
									key={repo.fullName}
									className="flex items-center gap-3 text-sm"
								>
									<div className="size-5 flex items-center justify-center">
										{isDone ? (
											<LuCheck className="size-4 text-green-500" />
										) : isCurrent ? (
											<LuLoader className="size-4 animate-spin text-primary" />
										) : (
											<div className="size-2 rounded-full bg-muted-foreground/30" />
										)}
									</div>
									<span
										className={
											isDone || isCurrent
												? "text-foreground"
												: "text-muted-foreground"
										}
									>
										{repo.name}
									</span>
									{(isCurrent || isDone) && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="ml-auto text-muted-foreground">
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
									)}
								</div>
							);
						})}
					</div>
				) : (
					<div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto">
						<div className="flex flex-col gap-1.5">
							<div className="flex items-center gap-1.5">
								<label
									htmlFor="add-repo-branch-name"
									className="text-sm font-medium text-foreground"
								>
									Branch name
								</label>
								<span className="text-xs text-muted-foreground">
									(optional)
								</span>
							</div>
							<Input
								id="add-repo-branch-name"
								value={branchName}
								onChange={(e) => setBranchName(e.target.value)}
								placeholder="feature/my-feature"
							/>
						</div>
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
							onError={(error) => toast.error(error)}
						/>
					</div>
				)}

				<DialogFooter className="px-4 pb-4 pt-2 border-t border-border flex-row justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => handleOpenChange(false)}
						disabled={isSubmitting}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						onClick={handleSubmit}
						disabled={selectedRepos.length === 0 || isSubmitting}
					>
						Add repo{selectedRepos.length === 1 ? "" : "s"}
						{selectedRepos.length > 0 ? ` (${selectedRepos.length})` : ""}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
