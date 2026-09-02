import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useMemo } from "react";
import { HiChevronRight } from "react-icons/hi2";
import { useWorkspaceShortcuts } from "renderer/hooks/useWorkspaceShortcuts";
import { useWorkspaceSelectionStore } from "renderer/stores/workspace-selection";
import { useWorkspaceSidebarStore } from "renderer/stores/workspace-sidebar-state";
import { useAutoFetchBranches } from "../../hooks/useAutoFetchBranches";
import { MultiDragPreview } from "./MultiDragPreview";
import { PortsList } from "./PortsList";
import { ProjectSection } from "./ProjectSection";
import { SetupScriptCard } from "./SetupScriptCard";
import { SidebarDropZone } from "./SidebarDropZone";
import { WorkspaceSidebarFooter } from "./WorkspaceSidebarFooter";

interface WorkspaceSidebarProps {
	isCollapsed?: boolean;
	activeProjectId: string | null;
	activeProjectName: string | null;
}

export function WorkspaceSidebar({
	isCollapsed = false,
	activeProjectId,
	activeProjectName,
}: WorkspaceSidebarProps) {
	const { groups } = useWorkspaceShortcuts();
	useAutoFetchBranches();
	const clearSelection = useWorkspaceSelectionStore((s) => s.clearSelection);
	const collapsedCategoryKeys = useWorkspaceSidebarStore(
		(s) => s.collapsedCategoryKeys,
	);
	const toggleCategoryCollapsed = useWorkspaceSidebarStore(
		(s) => s.toggleCategoryCollapsed,
	);

	const groupsByCategory = useMemo(() => {
		const withIndices = groups.map((group, globalIndex) => ({
			group,
			globalIndex,
		}));
		return {
			normal: withIndices.filter(
				({ group }) =>
					!(group.project.isGitless ?? false) &&
					!(group.project.isFeatureProject ?? false),
			),
			gitless: withIndices.filter(
				({ group }) =>
					(group.project.isGitless ?? false) &&
					!(group.project.isFeatureProject ?? false),
			),
			feature: withIndices.filter(
				({ group }) => group.project.isFeatureProject ?? false,
			),
		};
	}, [groups]);

	const gitWorkspaces = useMemo(() => {
		const normal = groupsByCategory.normal.flatMap(({ group }) => [
			...group.workspaces.map((w) => ({
				workspaceId: w.id,
				repoName: group.project.name,
				branch: w.branch,
			})),
			...(group.sections ?? []).flatMap((s) =>
				s.workspaces.map((w) => ({
					workspaceId: w.id,
					repoName: group.project.name,
					branch: w.branch,
				})),
			),
		]);
		const feature = groupsByCategory.feature.flatMap(({ group }) =>
			(group.childProjects ?? [])
				.filter((c): c is typeof c & { workspaceId: string } => !!c.workspaceId)
				.map((c) => ({
					workspaceId: c.workspaceId,
					repoName: c.name,
					branch: c.workspaceBranch,
				})),
		);
		return [...normal, ...feature];
	}, [groupsByCategory]);

	const projectShortcutIndices = useMemo(() => {
		const ordered = [
			...groupsByCategory.normal,
			...groupsByCategory.gitless,
			...groupsByCategory.feature,
		];
		const map = new Map<string, number>();
		let cumulative = 0;
		for (const { group } of ordered) {
			map.set(group.project.id, cumulative);
			cumulative +=
				group.workspaces.length +
				(group.sections ?? []).reduce((sum, s) => sum + s.workspaces.length, 0);
		}
		return map;
	}, [groupsByCategory]);

	const categories = useMemo(
		() =>
			[
				{
					key: "normal" as const,
					label: "Repos",
					items: groupsByCategory.normal,
				},
				{
					key: "gitless" as const,
					label: "Folders",
					items: groupsByCategory.gitless,
				},
				{
					key: "feature" as const,
					label: "Feature Projects",
					items: groupsByCategory.feature,
				},
			].filter((c) => c.items.length > 0),
		[groupsByCategory],
	);

	const showCategoryHeaders = categories.length > 1;

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (
					(e.target as HTMLElement).closest(
						"input, textarea, [contenteditable]",
					)
				)
					return;
				clearSelection();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [clearSelection]);

	const handleSidebarMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (
				(e.target as HTMLElement).closest("[role='button'], button, a, input")
			) {
				return;
			}
			clearSelection();
		},
		[clearSelection],
	);

	return (
		<SidebarDropZone className="flex flex-col h-full bg-muted/45 dark:bg-muted/35">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown on empty sidebar space clears selection */}
			<div
				className="flex-1 overflow-y-auto hide-scrollbar"
				onMouseDown={handleSidebarMouseDown}
			>
				{categories.map((category, catIdx) => {
					// Category collapsing only applies when headers are shown in the
					// expanded sidebar; the icon-only view has no header to toggle.
					const isCategoryCollapsed =
						showCategoryHeaders &&
						!isCollapsed &&
						collapsedCategoryKeys.includes(category.key);

					return (
						<div key={category.key}>
							{showCategoryHeaders && catIdx > 0 && isCollapsed && (
								<div className="flex justify-center py-1">
									<div className="w-5 border-t border-border" />
								</div>
							)}
							{showCategoryHeaders && !isCollapsed && (
								<button
									type="button"
									onClick={() => toggleCategoryCollapsed(category.key)}
									className={cn(
										"flex items-center gap-1 w-full px-3 pb-0.5 text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground uppercase tracking-wider select-none transition-colors",
										catIdx === 0 ? "pt-2" : "pt-3",
									)}
									aria-expanded={!isCategoryCollapsed}
								>
									<HiChevronRight
										className={cn(
											"size-3 shrink-0 transition-transform duration-150",
											!isCategoryCollapsed && "rotate-90",
										)}
									/>
									<span className="truncate">{category.label}</span>
								</button>
							)}
							{!isCategoryCollapsed &&
								category.items.map(({ group, globalIndex }) => (
									<ProjectSection
										key={group.project.id}
										projectId={group.project.id}
										projectName={group.project.name}
										projectColor={group.project.color}
	
										mainRepoPath={group.project.mainRepoPath}
										hideImage={group.project.hideImage}
										iconUrl={group.project.iconUrl}
										iconLetter={group.project.iconLetter}
										isGitless={group.project.isGitless ?? false}
										isFeatureProject={group.project.isFeatureProject ?? false}
										childProjects={group.childProjects ?? []}
										workspaces={group.workspaces}
										sections={group.sections ?? []}
										topLevelItems={group.topLevelItems}
										shortcutBaseIndex={
											projectShortcutIndices.get(group.project.id) ?? 0
										}
										index={globalIndex}
										isCollapsed={isCollapsed}
									/>
								))}
						</div>
					);
				})}

				{groups.length === 0 && !isCollapsed && (
					<div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
						<span>No worktrees yet</span>
						<span className="text-xs mt-1">
							Add project or drag a Git repo folder here
						</span>
					</div>
				)}
			</div>

			{!isCollapsed && <PortsList />}

			<SetupScriptCard
				isCollapsed={isCollapsed}
				projectId={activeProjectId}
				projectName={activeProjectName}
			/>

			<WorkspaceSidebarFooter
				isCollapsed={isCollapsed}
				gitWorkspaces={gitWorkspaces}
			/>
			<MultiDragPreview />
		</SidebarDropZone>
	);
}
