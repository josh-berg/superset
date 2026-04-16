import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMemo, useRef, useState } from "react";
import { TbGitBranch } from "react-icons/tb";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface SwitchBranchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	worktreePath: string;
	currentBranch: string;
}

export function SwitchBranchDialog({
	open,
	onOpenChange,
	worktreePath,
	currentBranch,
}: SwitchBranchDialogProps) {
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const { data, isLoading } = electronTrpc.changes.getBranches.useQuery(
		{ worktreePath },
		{ enabled: open, staleTime: 5000, refetchOnWindowFocus: false },
	);

	const utils = electronTrpc.useUtils();

	const switchBranch = electronTrpc.changes.switchBranch.useMutation({
		onMutate: async ({ branch: newBranch }) => {
			await utils.workspaces.getAllGrouped.cancel();
			const previous = utils.workspaces.getAllGrouped.getData();
			utils.workspaces.getAllGrouped.setData(undefined, (old) => {
				if (!old) return old;
				return old.map((group) => ({
					...group,
					workspaces: group.workspaces.map((w) =>
						w.worktreePath === worktreePath ? { ...w, branch: newBranch } : w,
					),
					sections: group.sections.map((section) => ({
						...section,
						workspaces: section.workspaces.map((w) =>
							w.worktreePath === worktreePath ? { ...w, branch: newBranch } : w,
						),
					})),
				}));
			});
			return { previous };
		},
		onSuccess: () => {
			onOpenChange(false);
			setSearch("");
			setError(null);
			void utils.workspaces.getAllGrouped.invalidate();
		},
		onError: (err: unknown, _vars, context) => {
			if (context?.previous !== undefined) {
				utils.workspaces.getAllGrouped.setData(undefined, context.previous);
			}
			const msg = err instanceof Error ? err.message : String(err);
			// Detect worktree-in-use error from git
			if (
				msg.includes("already checked out") ||
				msg.includes("is already used by worktree")
			) {
				setError(
					"This branch is checked out in another workspace and cannot be switched to.",
				);
			} else {
				setError(msg);
			}
		},
	});

	type BranchEntry = { branch: string; isRemote: boolean };

	const filteredBranches = useMemo((): BranchEntry[] => {
		if (!data) return [];
		const q = search.toLowerCase();
		const localNames = new Set(
			data.local.map((b: { branch: string }) => b.branch),
		);
		const localEntries: BranchEntry[] = data.local
			.filter((b: { branch: string }) => b.branch.toLowerCase().includes(q))
			.map((b: { branch: string }) => ({ branch: b.branch, isRemote: false }));
		// Include remote branches that don't already exist locally
		const remoteEntries: BranchEntry[] = data.remote
			.filter(
				(branch: string) =>
					!localNames.has(branch) && branch.toLowerCase().includes(q),
			)
			.map((branch: string) => ({ branch, isRemote: true }));
		return [...localEntries, ...remoteEntries];
	}, [data, search]);

	const checkedOutBranches = data?.checkedOutBranches ?? {};

	function handleSelect(branch: string) {
		if (branch === currentBranch) {
			onOpenChange(false);
			return;
		}
		setError(null);
		switchBranch.mutate({ worktreePath, branch });
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(val) => {
				if (!val) {
					setSearch("");
					setError(null);
				}
				onOpenChange(val);
			}}
		>
			<DialogContent
				className="max-w-[360px] gap-0 p-0"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					inputRef.current?.focus();
				}}
			>
				<DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
					<DialogTitle className="text-sm font-medium">
						Switch branch
					</DialogTitle>
				</DialogHeader>

				<div className="px-3 pt-3 pb-2">
					<Input
						ref={inputRef}
						placeholder="Filter branches…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-7 text-xs"
					/>
				</div>

				{error && (
					<div className="mx-3 mb-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-2.5 py-1.5">
						{error}
					</div>
				)}

				<div className="flex flex-col max-h-[280px] overflow-y-auto pb-2">
					{isLoading ? (
						<div className="px-4 py-3 text-xs text-muted-foreground">
							Loading branches…
						</div>
					) : filteredBranches.length === 0 ? (
						<div className="px-4 py-3 text-xs text-muted-foreground">
							No branches found
						</div>
					) : (
						filteredBranches.map(({ branch, isRemote }: BranchEntry) => {
							const isCurrent = branch === currentBranch;
							const checkedOutPath = checkedOutBranches[branch];
							const isCheckedOutElsewhere = Boolean(checkedOutPath);
							const isDisabled =
								isCheckedOutElsewhere || switchBranch.isPending;

							const item = (
								<button
									type="button"
									disabled={isDisabled}
									onClick={() => handleSelect(branch)}
									className={cn(
										"flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left",
										"hover:bg-accent transition-colors",
										isCurrent && "font-medium",
										isCheckedOutElsewhere && "opacity-50 cursor-not-allowed",
										switchBranch.isPending &&
											switchBranch.variables?.branch === branch &&
											"opacity-70",
									)}
								>
									<TbGitBranch className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate">{branch}</span>
									<span className="ml-auto flex items-center gap-1.5 shrink-0">
										{isRemote && (
											<span className="text-[10px] text-muted-foreground">
												remote
											</span>
										)}
										{isCurrent && (
											<span className="text-[10px] text-muted-foreground">
												current
											</span>
										)}
										{isCheckedOutElsewhere && (
											<span className="text-[10px] text-muted-foreground">
												in use
											</span>
										)}
									</span>
								</button>
							);

							if (isCheckedOutElsewhere) {
								return (
									<Tooltip key={branch} delayDuration={300}>
										<TooltipTrigger asChild>{item}</TooltipTrigger>
										<TooltipContent
											side="right"
											className="text-xs max-w-[220px]"
										>
											Checked out in another workspace
										</TooltipContent>
									</Tooltip>
								);
							}

							return <div key={branch}>{item}</div>;
						})
					)}
				</div>

				<div className="px-3 pb-3 pt-1 border-t border-border flex justify-end">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
