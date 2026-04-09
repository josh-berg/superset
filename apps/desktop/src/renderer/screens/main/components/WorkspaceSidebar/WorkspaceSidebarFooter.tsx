import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useMatchRoute } from "@tanstack/react-router";
import { LuPlus } from "react-icons/lu";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { STROKE_WIDTH_THICK } from "./constants";

interface WorkspaceSidebarFooterProps {
	isCollapsed?: boolean;
}

export function WorkspaceSidebarFooter({
	isCollapsed = false,
}: WorkspaceSidebarFooterProps) {
	const openModal = useOpenNewWorkspaceModal();
	const shortcutText = useHotkeyDisplay("NEW_WORKSPACE").text;

	const matchRoute = useMatchRoute();
	const currentWorkspaceMatch = matchRoute({
		to: "/workspace/$workspaceId",
		fuzzy: true,
	});
	const currentWorkspaceId = currentWorkspaceMatch
		? currentWorkspaceMatch.workspaceId
		: null;

	const { data: currentWorkspace } = electronTrpc.workspaces.get.useQuery(
		{ id: currentWorkspaceId ?? "" },
		{ enabled: !!currentWorkspaceId },
	);

	const handleClick = () => {
		openModal(currentWorkspace?.projectId);
	};

	if (isCollapsed) {
		return (
			<div className="border-t border-border p-2 flex flex-col items-center gap-1">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleClick}
							className="group flex items-center justify-center size-8 rounded-md bg-accent/40 hover:bg-accent/60 transition-colors"
						>
							<div className="flex items-center justify-center size-5 rounded bg-accent">
								<LuPlus className="size-3" strokeWidth={STROKE_WIDTH_THICK} />
							</div>
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">
						New Workspace ({shortcutText})
					</TooltipContent>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className="border-t border-border p-2">
			<button
				type="button"
				onClick={handleClick}
				className="group flex items-center gap-2 px-2 py-1.5 w-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors"
			>
				<LuPlus className="size-4" strokeWidth={STROKE_WIDTH_THICK} />
				<span className="flex-1 text-left">New Workspace</span>
				<span className="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/80 transition-colors font-mono tabular-nums shrink-0">
					{shortcutText}
				</span>
			</button>
		</div>
	);
}
