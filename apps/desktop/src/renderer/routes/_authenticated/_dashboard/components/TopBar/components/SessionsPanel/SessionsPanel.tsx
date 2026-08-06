import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";
import { LuGitBranch } from "react-icons/lu";
import claudeIcon from "renderer/assets/app-icons/preset-icons/claude.svg";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { AsciiSpinner } from "renderer/screens/main/components/AsciiSpinner";
import { StatusIndicator } from "renderer/screens/main/components/StatusIndicator";
import { useTabsStore } from "renderer/stores/tabs/store";
import type { Pane } from "renderer/stores/tabs/types";
import {
	type ActivePaneStatus,
	type PaneStatus,
	STATUS_PRIORITY,
} from "shared/tabs-types";
import { useShallow } from "zustand/react/shallow";

interface SessionEntry {
	tabId: string;
	tabName: string;
	kind: "claude" | "terminal";
	status: ActivePaneStatus | null;
}

interface WorkspaceGroup {
	workspaceId: string;
	workspaceName: string;
	projectName: string;
	/** True for feature projects and their child repos (multi-repo). */
	isMultiRepo: boolean;
	/** Set when this workspace's project is a child repo of a feature (multi-repo) project. */
	parentProjectName: string | null;
	sessions: SessionEntry[];
}

export function SessionsPanel() {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();

	const tabs = useTabsStore((state) => state.tabs);
	const panes = useTabsStore(useShallow((state) => state.panes));
	const setActiveTab = useTabsStore((state) => state.setActiveTab);

	const { data: workspacesData = [], isFetched: workspacesFetched } =
		electronTrpc.workspaces.getAll.useQuery();
	const { data: projectsData = [] } =
		electronTrpc.projects.getRecents.useQuery();

	const workspaceMap = useMemo(
		() => new Map(workspacesData.map((w) => [w.id, w])),
		[workspacesData],
	);

	const projectMap = useMemo(
		() => new Map(projectsData.map((p) => [p.id, p])),
		[projectsData],
	);

	const { groups, totalClaude, workingClaude, totalTerminal } = useMemo(() => {
		if (!workspacesFetched) {
			return { groups: [], totalClaude: 0, workingClaude: 0, totalTerminal: 0 };
		}

		const panesByTab = new Map<string, Pane[]>();
		for (const pane of Object.values(panes)) {
			const existing = panesByTab.get(pane.tabId);
			if (existing) existing.push(pane);
			else panesByTab.set(pane.tabId, [pane]);
		}

		const byWorkspace = new Map<string, SessionEntry[]>();
		let totalClaude = 0;
		let workingClaude = 0;
		let totalTerminal = 0;

		for (const tab of tabs) {
			if (!workspaceMap.has(tab.workspaceId)) continue;
			const tabPanes = panesByTab.get(tab.id) ?? [];
			const hasChat = tabPanes.some((p) => p.type === "chat");
			const hasClaudeTerminal = tabPanes.some(
				(p) => p.type === "terminal" && p.runningClaude,
			);
			const hasTerminal = tabPanes.some((p) => p.type === "terminal");

			const kind: "claude" | "terminal" | null =
				hasChat || hasClaudeTerminal
					? "claude"
					: hasTerminal
						? "terminal"
						: null;

			if (!kind) continue;

			let highest: PaneStatus = "idle";
			for (const pane of tabPanes) {
				if (
					pane.status &&
					STATUS_PRIORITY[pane.status] > STATUS_PRIORITY[highest]
				) {
					highest = pane.status;
				}
			}
			const status: ActivePaneStatus | null =
				highest === "idle" ? null : (highest as ActivePaneStatus);

			if (kind === "claude") {
				totalClaude++;
				if (status === "working" || status === "permission") workingClaude++;
			} else {
				totalTerminal++;
			}

			const existing = byWorkspace.get(tab.workspaceId) ?? [];
			existing.push({
				tabId: tab.id,
				tabName: tab.userTitle ?? tab.name,
				kind,
				status,
			});
			byWorkspace.set(tab.workspaceId, existing);
		}

		const groups: WorkspaceGroup[] = [];
		for (const [workspaceId, sessions] of byWorkspace) {
			const workspace = workspaceMap.get(workspaceId);
			const project = workspace
				? projectMap.get(workspace.projectId)
				: undefined;
			const parentProject = project?.parentProjectId
				? projectMap.get(project.parentProjectId)
				: undefined;
			// Branch workspaces are created with name="default" — not useful as a label.
			// Promote the project name to primary and use the branch as secondary instead.
			const isGenericName =
				workspace?.name === "default" || workspace?.isUnnamed;
			groups.push({
				workspaceId,
				workspaceName: isGenericName
					? (project?.name ?? workspace?.branch ?? "Unknown")
					: (workspace?.name ?? "Unknown"),
				projectName: isGenericName
					? (workspace?.branch ?? "")
					: (project?.name ?? ""),
				isMultiRepo: !!(project?.isFeatureProject || project?.parentProjectId),
				parentProjectName: parentProject?.name ?? null,
				sessions,
			});
		}

		groups.sort((a, b) => {
			// Single repos before multi-repo (feature) projects
			if (a.isMultiRepo !== b.isMultiRepo) return a.isMultiRepo ? 1 : -1;
			// Within multi-repo: group child repos with their parent project
			const aTop = a.parentProjectName ?? a.workspaceName;
			const bTop = b.parentProjectName ?? b.workspaceName;
			const topCmp = aTop.localeCompare(bTop);
			if (topCmp !== 0) return topCmp;
			// Within the same top-level project, feature project workspace before child repos
			if (a.parentProjectName && !b.parentProjectName) return 1;
			if (!a.parentProjectName && b.parentProjectName) return -1;
			return a.workspaceName.localeCompare(b.workspaceName);
		});

		return { groups, totalClaude, workingClaude, totalTerminal };
	}, [tabs, panes, workspaceMap, projectMap, workspacesFetched]);

	if (totalClaude === 0 && totalTerminal === 0) return null;

	const navigateToSession = (workspaceId: string, tabId: string) => {
		setActiveTab(workspaceId, tabId);
		navigate({ to: `/workspace/${workspaceId}` });
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip delayDuration={150}>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="no-drag flex items-center gap-1.5 h-6 px-1.5 rounded border border-border/60 bg-secondary/50 hover:bg-secondary hover:border-border transition-all duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-ring"
							aria-label="Sessions"
						>
							{totalClaude > 0 && (
								<span className="flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
									<img src={claudeIcon} alt="" className="size-3 shrink-0" />
									{totalClaude}
									{workingClaude > 0 && (
										<>
											<AsciiSpinner />
											{workingClaude}
										</>
									)}
								</span>
							)}
							{totalClaude > 0 && totalTerminal > 0 && (
								<span className="text-border text-[10px]">·</span>
							)}
							{totalTerminal > 0 && (
								<span className="flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
									<SquareTerminal className="size-3 shrink-0" />
									{totalTerminal}
								</span>
							)}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={6} showArrow={false}>
					<span>
						{totalClaude} Claude {totalClaude === 1 ? "session" : "sessions"},{" "}
						{workingClaude} working · {totalTerminal}{" "}
						{totalTerminal === 1 ? "terminal" : "terminals"}
					</span>
				</TooltipContent>
			</Tooltip>

			<PopoverContent align="start" className="w-72 p-0">
				<div className="px-3 py-2.5 border-b border-border">
					<h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
						Sessions
					</h4>
				</div>

				<div className="max-h-[50vh] overflow-y-auto">
					{groups.length === 0 ? (
						<div className="px-3 py-4 text-center text-xs text-muted-foreground">
							No active sessions
						</div>
					) : (
						groups.map((group) => (
							<WorkspaceSessionGroup
								key={group.workspaceId}
								group={group}
								onNavigate={navigateToSession}
							/>
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function WorkspaceSessionGroup({
	group,
	onNavigate,
}: {
	group: WorkspaceGroup;
	onNavigate: (workspaceId: string, tabId: string) => void;
}) {
	return (
		<div className="border-b border-border/60 last:border-0">
			<div className="px-3 pt-2 pb-1">
				<div className="text-[11px] font-medium text-foreground truncate">
					{group.workspaceName}
				</div>
				{group.parentProjectName ? (
					<div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
						<LuGitBranch className="size-2.5 shrink-0 opacity-70" />
						<span className="truncate">
							{group.parentProjectName}
							<span className="mx-1 opacity-50">/</span>
							{group.projectName}
						</span>
					</div>
				) : group.projectName ? (
					<div className="text-[10px] text-muted-foreground truncate">
						{group.projectName}
					</div>
				) : null}
			</div>

			<div className="pb-1">
				{group.sessions.map((session) => (
					<button
						key={session.tabId}
						type="button"
						className="w-full flex items-center gap-2 pl-5 pr-3 py-0.5 hover:bg-muted/50 transition-colors text-left"
						onClick={() => onNavigate(group.workspaceId, session.tabId)}
					>
						{session.kind === "claude" ? (
							<img
								src={claudeIcon}
								alt=""
								className="size-3 shrink-0 opacity-60"
							/>
						) : (
							<SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
						)}
						<span className="flex-1 text-xs text-muted-foreground truncate">
							{session.tabName}
						</span>
						{session.status && <StatusIndicator status={session.status} />}
					</button>
				))}
			</div>
		</div>
	);
}
