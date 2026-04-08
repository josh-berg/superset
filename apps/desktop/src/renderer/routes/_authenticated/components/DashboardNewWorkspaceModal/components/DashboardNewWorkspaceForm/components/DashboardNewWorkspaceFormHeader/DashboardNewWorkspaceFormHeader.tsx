import type { WorkspaceHostTarget } from "renderer/lib/v2-workspace-host";
import { DevicePicker } from "../DevicePicker";
import { ProjectSelector } from "../ProjectSelector";

interface DashboardNewWorkspaceFormHeaderProps {
	hostTarget: WorkspaceHostTarget;
	selectedProjectId: string | null;
	onSelectHostTarget: (hostTarget: WorkspaceHostTarget) => void;
	onSelectProject: (projectId: string | null) => void;
}

export function DashboardNewWorkspaceFormHeader({
	hostTarget,
	selectedProjectId,
	onSelectHostTarget,
	onSelectProject,
}: DashboardNewWorkspaceFormHeaderProps) {
	return (
		<div className="flex items-center justify-between border-b px-4 py-2.5">
			<span className="text-sm font-medium">New Workspace</span>
			<div className="flex items-center gap-1">
				<DevicePicker
					hostTarget={hostTarget}
					onSelectHostTarget={onSelectHostTarget}
				/>
				<div className="mx-0.5 h-4 w-px bg-border" />
				<ProjectSelector
					selectedProjectId={selectedProjectId}
					onSelectProject={onSelectProject}
				/>
			</div>
		</div>
	);
}
