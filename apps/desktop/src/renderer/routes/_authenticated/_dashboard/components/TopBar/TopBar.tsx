import { useParams } from "@tanstack/react-router";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SidebarControl } from "renderer/screens/main/components/SidebarControl";
import { ClaudeCosts } from "./components/ClaudeCosts";
import { NavigationControls } from "./components/NavigationControls";
import { OpenInMenuButton } from "./components/OpenInMenuButton";
import { ResourceConsumption } from "./components/ResourceConsumption";
import { SidebarToggle } from "./components/SidebarToggle";
import { WindowControls } from "./components/WindowControls";

export function TopBar() {
	const { data: platform } = electronTrpc.window.getPlatform.useQuery();
	const { workspaceId } = useParams({ strict: false });
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: workspaceId ?? "" },
		{ enabled: !!workspaceId },
	);
	// Default to Mac layout while loading to avoid overlap with traffic lights
	const isMac = platform === undefined || platform === "darwin";

	return (
		<div className="drag gap-2 h-12 w-full flex items-center justify-between bg-muted/45 border-b border-border relative dark:bg-muted/35">
			<div
				className="flex items-center gap-1.5 h-full"
				style={{
					paddingLeft: isMac ? "88px" : "16px",
				}}
			>
				<SidebarToggle />
				<NavigationControls />
				<ResourceConsumption />
				<ClaudeCosts />
			</div>

			<div className="flex items-center gap-3 h-full pr-4 shrink-0">
				{workspace?.worktreePath ? (
					<OpenInMenuButton
						worktreePath={workspace.worktreePath}
						branch={workspace.worktree?.branch}
						projectId={workspace.project?.id}
					/>
				) : null}
				{workspaceId && <SidebarControl />}
				{!isMac && <WindowControls />}
			</div>
		</div>
	);
}
