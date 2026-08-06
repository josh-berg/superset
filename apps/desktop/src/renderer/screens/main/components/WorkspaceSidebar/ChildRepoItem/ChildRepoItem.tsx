import { cn } from "@superset/ui/utils";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuGitBranch } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { navigateToWorkspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { AsciiSpinner } from "renderer/screens/main/components/AsciiSpinner";
import { StatusIndicator } from "renderer/screens/main/components/StatusIndicator";
import { useTabsStore } from "renderer/stores/tabs/store";
import { extractPaneIdsFromLayout } from "renderer/stores/tabs/utils";
import { getHighestPriorityStatus } from "shared/tabs-types";
import { RunningTabCounts } from "../RunningTabCounts";
import { SwitchBranchDialog } from "../WorkspaceListItem/components/SwitchBranchDialog";
import { GITHUB_STATUS_STALE_TIME } from "../WorkspaceListItem/constants";
import { WorkspaceAheadBehind } from "../WorkspaceListItem/WorkspaceAheadBehind";

interface ChildRepoItemProps {
	workspaceId: string | null;
	mainRepoPath: string;
	name: string;
	branch: string;
	isCollapsed?: boolean;
}

export function ChildRepoItem({
	workspaceId,
	mainRepoPath,
	name,
	branch,
	isCollapsed = false,
}: ChildRepoItemProps) {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const [showSwitchBranchDialog, setShowSwitchBranchDialog] = useState(false);

	const { data: aheadBehind } = electronTrpc.workspaces.getAheadBehind.useQuery(
		{ workspaceId: workspaceId ?? "" },
		{ enabled: !!workspaceId, staleTime: GITHUB_STATUS_STALE_TIME },
	);
	const isBehind = (aheadBehind?.behind ?? 0) > 0;

	const workspaceStatus = useTabsStore((state) => {
		if (!workspaceId) return null;
		function* paneStatuses() {
			for (const tab of state.tabs) {
				if (tab.workspaceId !== workspaceId) continue;
				for (const paneId of extractPaneIdsFromLayout(tab.layout)) {
					yield state.panes[paneId]?.status;
				}
			}
		}
		return getHighestPriorityStatus(paneStatuses());
	});

	const isActive =
		!!workspaceId &&
		!!matchRoute({
			to: "/workspace/$workspaceId",
			params: { workspaceId },
			fuzzy: true,
		});

	const handleClick = () => {
		if (!workspaceId) return;
		navigateToWorkspace(workspaceId, navigate);
	};

	if (isCollapsed) {
		return (
			<button
				type="button"
				onClick={handleClick}
				disabled={!workspaceId}
				title={`${name}: ${branch}${isBehind ? ` (↓${aheadBehind?.behind})` : ""}`}
				className={cn(
					"relative flex items-center justify-center size-8 rounded-md transition-colors",
					isActive
						? "bg-primary/10 text-primary"
						: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
					!workspaceId && "opacity-40 cursor-default",
				)}
			>
				{workspaceStatus === "working" ? (
					<AsciiSpinner className="text-base" />
				) : (
					<LuGitBranch className="size-3.5" />
				)}
				{workspaceStatus && workspaceStatus !== "working" && (
					<span className="absolute top-1 right-1">
						<StatusIndicator status={workspaceStatus} />
					</span>
				)}
				{!workspaceStatus && isBehind && (
					<span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-400" />
				)}
			</button>
		);
	}

	return (
		<>
			<button
				type="button"
				onClick={handleClick}
				disabled={!workspaceId}
				className={cn(
					"group flex items-center gap-2 w-full pl-4 pr-2 py-1 text-left rounded-md transition-colors min-h-[28px]",
					isActive
						? "bg-primary/10 text-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
					!workspaceId && "opacity-40 cursor-default",
				)}
			>
				<span className="relative shrink-0 flex items-center justify-center size-4">
					{workspaceStatus === "working" ? (
						<AsciiSpinner className="text-base" />
					) : (
						<LuGitBranch className="size-3.5 opacity-60" />
					)}
					{workspaceStatus && workspaceStatus !== "working" && (
						<span className="absolute -top-0.5 -right-0.5">
							<StatusIndicator status={workspaceStatus} />
						</span>
					)}
				</span>
				<span className="flex-1 text-xs font-medium truncate">{name}</span>
				{workspaceId && <RunningTabCounts workspaceIds={[workspaceId]} />}
				{aheadBehind && (
					<WorkspaceAheadBehind
						ahead={aheadBehind.ahead}
						behind={aheadBehind.behind}
					/>
				)}
				{branch && workspaceId && (
					<span
						role="button"
						tabIndex={0}
						onClick={(e) => {
							e.stopPropagation();
							setShowSwitchBranchDialog(true);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								setShowSwitchBranchDialog(true);
							}
						}}
						className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[80px] shrink-0 rounded px-0.5 -mx-0.5 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
					>
						{branch}
					</span>
				)}
				{branch && !workspaceId && (
					<span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[80px] shrink-0">
						{branch}
					</span>
				)}
			</button>
			<SwitchBranchDialog
				open={showSwitchBranchDialog}
				onOpenChange={setShowSwitchBranchDialog}
				worktreePath={mainRepoPath}
				currentBranch={branch}
			/>
		</>
	);
}
