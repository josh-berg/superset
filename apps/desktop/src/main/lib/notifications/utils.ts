/**
 * Extracts the workspace ID from a hash-routed URL.
 *
 * The app uses hash routing, so URLs look like:
 * - file:///path/to/app/index.html#/workspace/abc123
 * - file:///Users/foo/workspace/superset/dist/index.html#/workspace/abc123?foo=bar
 *
 * This function parses the hash portion to avoid matching /workspace/ in the file path.
 */
export function extractWorkspaceIdFromUrl(url: string): string | null {
	try {
		const hash = new URL(url).hash;
		const match = hash.match(/\/workspace\/([^/?#]+)/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

interface TabsState {
	activeTabIds?: Record<string, string | null>;
	focusedPaneIds?: Record<string, string>;
}

interface PaneLocation {
	workspaceId: string;
	tabId: string;
	paneId: string;
}

/**
 * Determines if a pane is currently visible to the user.
 *
 * A pane is visible when:
 * 1. User is viewing the workspace containing the pane
 * 2. The tab is the active tab in that workspace
 * 3. The pane is the focused pane in that tab
 */
export function isPaneVisible({
	currentWorkspaceId,
	tabsState,
	pane,
}: {
	currentWorkspaceId: string | null;
	tabsState: TabsState | undefined;
	pane: PaneLocation;
}): boolean {
	if (!currentWorkspaceId || !tabsState) {
		return false;
	}

	const isViewingWorkspace = currentWorkspaceId === pane.workspaceId;
	const isActiveTab = tabsState.activeTabIds?.[pane.workspaceId] === pane.tabId;
	const isFocusedPane = tabsState.focusedPaneIds?.[pane.tabId] === pane.paneId;

	return isViewingWorkspace && isActiveTab && isFocusedPane;
}

interface BaseTab {
	id: string;
	name: string;
	userTitle?: string;
}

interface Pane {
	name: string;
}

/**
 * Derives a display title for a notification from tab/pane state.
 * Priority: tab.userTitle > tab.name > pane.name > "Terminal"
 */
export function getNotificationTitle({
	tabId,
	paneId,
	tabs,
	panes,
}: {
	tabId?: string;
	paneId?: string;
	tabs?: BaseTab[];
	panes?: Record<string, Pane>;
}): string {
	const tab = tabId ? tabs?.find((t) => t.id === tabId) : undefined;
	const pane = paneId ? panes?.[paneId] : undefined;
	return tab?.userTitle?.trim() || tab?.name || pane?.name || "Terminal";
}

interface Workspace {
	name: string | null;
	worktreeId: string | null;
	branch: string | null;
}

interface Worktree {
	branch: string | null;
}

interface Project {
	name: string | null;
	isGitless: boolean | null;
	isFeatureProject: boolean | null;
	parentProjectId: string | null;
}

interface ParentProject {
	name: string | null;
}

/**
 * Derives a display name for a workspace, falling back through available names.
 */
export function getWorkspaceName({
	workspace,
	worktree,
}: {
	workspace?: Workspace | null;
	worktree?: Worktree | null;
}): string {
	return workspace?.name || worktree?.branch || "Workspace";
}

export interface WorkspaceContext {
	/** Shown as the macOS notification banner title. */
	title: string;
	/** Shown as the first part of the notification body (branch, repo, "root", etc). Null for folder workspaces. */
	context: string | null;
}

/**
 * Derives rich notification context from workspace + project data.
 *
 * Title:
 *   - Repo workspace: project name (repo basename)
 *   - Feature project workspace: feature project name (parent project name for child repos)
 *   - Folder workspace: project name (folder basename)
 *
 * Context (body prefix):
 *   - Repo workspace: branch name
 *   - Feature project child workspace: child repo name
 *   - Feature project root workspace: "root"
 *   - Folder workspace: null
 */
export function getWorkspaceContext({
	workspace,
	worktree,
	project,
	parentProject,
}: {
	workspace?: Workspace | null;
	worktree?: Worktree | null;
	project?: Project | null;
	parentProject?: ParentProject | null;
}): WorkspaceContext {
	const isFeatureProjectChild = Boolean(project?.parentProjectId);
	const isFeatureProjectRoot = Boolean(
		project?.isFeatureProject && !project?.parentProjectId,
	);
	const isRepo = !project?.isGitless && !isFeatureProjectChild;

	if (isFeatureProjectChild) {
		return {
			title: parentProject?.name || project?.name || "Workspace",
			context: project?.name || null,
		};
	}

	if (isRepo) {
		const branch = worktree?.branch || workspace?.branch || null;
		return {
			title: project?.name || "Workspace",
			context: branch,
		};
	}

	if (isFeatureProjectRoot) {
		return {
			title: project?.name || "Workspace",
			context: "root",
		};
	}

	// Folder workspace
	return {
		title: project?.name || "Workspace",
		context: null,
	};
}
