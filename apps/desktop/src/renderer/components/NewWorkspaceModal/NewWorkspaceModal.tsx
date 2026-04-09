import {
	PromptInputProvider,
	usePromptInputController,
} from "@superset/ui/ai-elements/prompt-input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	useCloseNewWorkspaceModal,
	useNewWorkspaceModalOpen,
	usePreSelectedProjectId,
	useSkipProjectStep,
} from "renderer/stores/new-workspace-modal";
import { NewWorkspaceModalContent } from "./components/NewWorkspaceModalContent";
import {
	NewWorkspaceModalDraftProvider,
	useNewWorkspaceModalDraft,
} from "./NewWorkspaceModalDraftContext";

/** Clears the PromptInputProvider text & attachments when the draft resets. */
function PromptInputResetSync() {
	const { resetKey } = useNewWorkspaceModalDraft();
	const { textInput, attachments } = usePromptInputController();
	const prevResetKeyRef = useRef(resetKey);

	useEffect(() => {
		if (resetKey !== prevResetKeyRef.current) {
			prevResetKeyRef.current = resetKey;
			textInput.clear();
			attachments.clear();
		}
	}, [resetKey, textInput.clear, attachments.clear]);

	return null;
}

export function NewWorkspaceModal() {
	const isOpen = useNewWorkspaceModalOpen();
	const closeModal = useCloseNewWorkspaceModal();
	const navigate = useNavigate();
	const preSelectedProjectId = usePreSelectedProjectId();
	const skipProjectStep = useSkipProjectStep();

	// Prevents AgentSelect from flashing "No agent" while presets load after refresh.
	electronTrpc.settings.getAgentPresets.useQuery();

	const handleNewProject = () => {
		closeModal();
		navigate({ to: "/new-project" });
	};

	return (
		<NewWorkspaceModalDraftProvider onClose={closeModal}>
			<PromptInputProvider>
				<PromptInputResetSync />
				<Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
					<DialogHeader className="sr-only">
						<DialogTitle>New Workspace</DialogTitle>
						<DialogDescription>Create a new workspace</DialogDescription>
					</DialogHeader>
					<DialogContent
						showCloseButton={false}
						onFocusOutside={(e) => e.preventDefault()}
						className="bg-popover text-popover-foreground sm:max-w-[560px] max-h-[min(70vh,600px)] !top-[calc(50%-min(35vh,300px))] !-translate-y-0 flex flex-col overflow-hidden p-0"
					>
						<NewWorkspaceModalContent
							isOpen={isOpen}
							preSelectedProjectId={preSelectedProjectId}
							skipProjectStep={skipProjectStep}
							onNewProject={handleNewProject}
						/>
					</DialogContent>
				</Dialog>
			</PromptInputProvider>
		</NewWorkspaceModalDraftProvider>
	);
}
