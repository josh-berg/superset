import {
	createFileRoute,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { DndProvider } from "react-dnd";
import { NewWorkspaceModal } from "renderer/components/NewWorkspaceModal";
import { migrateHotkeyOverrides } from "renderer/hotkeys/migrate";
import { dragDropManager } from "renderer/lib/dnd";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { showWorkspaceAutoNameWarningToast } from "renderer/lib/workspaces/showWorkspaceAutoNameWarningToast";
import { InitGitDialog } from "renderer/react-query/projects/InitGitDialog";
import { WorkspaceInitEffects } from "renderer/screens/main/components/WorkspaceInitEffects";
import { useSettingsStore } from "renderer/stores/settings-state";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useAgentHookListener } from "renderer/stores/tabs/useAgentHookListener";
import { setPaneWorkspaceRunState } from "renderer/stores/tabs/workspace-run";
import { useWorkspaceInitStore } from "renderer/stores/workspace-init";
import { NOTIFICATION_EVENTS } from "shared/constants";
import { GlobalTerminalLifecycle } from "./components/GlobalTerminalLifecycle";
import { TeardownLogsDialog } from "./components/TeardownLogsDialog";
import { createPierreWorker } from "./lib/pierreWorker";
import { CollectionsProvider } from "./providers/CollectionsProvider";
import { LocalHostServiceProvider } from "./providers/LocalHostServiceProvider";

export const Route = createFileRoute("/_authenticated")({
	component: AppLayout,
});

function AppLayout() {
	const navigate = useNavigate();
	const location = useLocation();
	const setOriginRoute = useSettingsStore((s) => s.setOriginRoute);
	const utils = electronTrpc.useUtils();
	const shownWorkspaceInitWarningsRef = useRef(new Set<string>());

	useAgentHookListener();

	// One-time migration from old hotkey storage to new localStorage-based store
	useEffect(() => {
		void migrateHotkeyOverrides().catch((error) => {
			console.error("[hotkeys] Migration failed:", error);
		});
	}, []);

	// Update workspace-run pane state on terminal exit
	electronTrpc.notifications.subscribe.useSubscription(undefined, {
		onData: (event) => {
			if (
				event.type !== NOTIFICATION_EVENTS.TERMINAL_EXIT ||
				!event.data?.paneId
			) {
				return;
			}
			const pane = useTabsStore.getState().panes[event.data.paneId];
			if (pane?.workspaceRun?.state === "running") {
				const nextState =
					event.data.reason === "killed"
						? "stopped-by-user"
						: "stopped-by-exit";
				setPaneWorkspaceRunState(event.data.paneId, nextState);
			}
		},
	});

	useEffect(() => {
		if (!location.pathname.startsWith("/settings")) {
			setOriginRoute(location.pathname);
		}
	}, [location.pathname, setOriginRoute]);

	// Workspace initialization progress subscription
	const updateInitProgress = useWorkspaceInitStore((s) => s.updateProgress);
	electronTrpc.workspaces.onInitProgress.useSubscription(undefined, {
		onData: (progress) => {
			updateInitProgress(progress);
			if (
				progress.warning &&
				!shownWorkspaceInitWarningsRef.current.has(progress.workspaceId)
			) {
				shownWorkspaceInitWarningsRef.current.add(progress.workspaceId);
				showWorkspaceAutoNameWarningToast({
					description: progress.warning,
					onOpenModelAuthSettings: () => {
						void navigate({ to: "/settings/models" });
					},
				});
			}
			if (progress.step === "ready" || progress.step === "failed") {
				utils.workspaces.getAllGrouped.invalidate();
				utils.workspaces.get.invalidate({ id: progress.workspaceId });
			}
		},
		onError: (error) => {
			console.error("[workspace-init-subscription] Subscription error:", error);
		},
	});

	// Menu navigation subscription
	electronTrpc.menu.subscribe.useSubscription(undefined, {
		onData: (event) => {
			if (event.type === "open-settings") {
				const section = event.data.section || "appearance";
				navigate({ to: `/settings/${section}` as "/settings/appearance" });
			} else if (event.type === "open-workspace") {
				navigate({ to: `/workspace/${event.data.workspaceId}` });
			}
		},
	});

	return (
		<DndProvider manager={dragDropManager}>
			<CollectionsProvider>
				<GlobalTerminalLifecycle />
				<HostServiceProvider>
					<Outlet />
					<WorkspaceInitEffects />
					<NewWorkspaceModal />
					<InitGitDialog />
					<TeardownLogsDialog />
				</HostServiceProvider>
			</CollectionsProvider>
		</DndProvider>
	);
}
