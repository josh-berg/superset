import { Command, CommandInput, CommandList } from "@superset/ui/command";
import { useCallback } from "react";
import { useDashboardNewWorkspaceDraft } from "../../DashboardNewWorkspaceDraftContext";
import { BranchesGroup } from "./components/BranchesGroup";
import { DashboardNewWorkspaceFormHeader } from "./components/DashboardNewWorkspaceFormHeader";
import { useDashboardNewWorkspaceProjectSelection } from "./hooks/useDashboardNewWorkspaceProjectSelection";
import { useResolvedLocalProject } from "./hooks/useResolvedLocalProject";

const COMMAND_CLASS_NAME =
	"[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 flex h-full w-full flex-1 flex-col overflow-hidden rounded-none";

interface DashboardNewWorkspaceFormProps {
	isOpen: boolean;
	preSelectedProjectId: string | null;
}

/** Simplified workspace creation: select a project and branch, workspace is named after the branch. */
export function DashboardNewWorkspaceForm({
	isOpen,
	preSelectedProjectId,
}: DashboardNewWorkspaceFormProps) {
	const { draft, updateDraft } = useDashboardNewWorkspaceDraft();

	const handleSelectProject = useCallback(
		(selectedProjectId: string | null) => {
			updateDraft({ selectedProjectId });
		},
		[updateDraft],
	);

	const { githubRepository } = useDashboardNewWorkspaceProjectSelection({
		isOpen,
		preSelectedProjectId,
		selectedProjectId: draft.selectedProjectId,
		onSelectProject: handleSelectProject,
	});
	const resolvedLocalProjectId = useResolvedLocalProject(githubRepository);

	return (
		<>
			<DashboardNewWorkspaceFormHeader
				hostTarget={draft.hostTarget}
				selectedProjectId={draft.selectedProjectId}
				onSelectHostTarget={(hostTarget) => updateDraft({ hostTarget })}
				onSelectProject={handleSelectProject}
			/>
			<Command shouldFilter={false} className={COMMAND_CLASS_NAME}>
				<CommandInput
					value={draft.branchesQuery}
					onValueChange={(v) => updateDraft({ branchesQuery: v })}
					placeholder="Search branches..."
				/>
				<CommandList className="!max-h-none flex-1 overflow-y-auto">
					<BranchesGroup
						projectId={draft.selectedProjectId}
						localProjectId={resolvedLocalProjectId}
						hostTarget={draft.hostTarget}
					/>
				</CommandList>
			</Command>
		</>
	);
}
