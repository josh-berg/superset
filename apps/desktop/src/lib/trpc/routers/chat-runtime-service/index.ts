import type { LifecycleEvent } from "@superset/chat/server/trpc";
import { ChatRuntimeService } from "@superset/chat/server/trpc";
import { env } from "main/env.main";
import { appState } from "main/lib/app-state";
import { notificationsEmitter } from "main/lib/notifications/server";
import { NOTIFICATION_EVENTS } from "shared/constants";
function resolveNotificationIdsFromSession(sessionId: string): {
	paneId?: string;
	tabId?: string;
	workspaceId?: string;
} {
	try {
		const tabsState = appState.data.tabsState;
		if (!tabsState) return {};

		const paneId = Object.entries(tabsState.panes ?? {}).find(
			([_paneId, pane]) => pane.chat?.sessionId === sessionId,
		)?.[0];
		if (!paneId) return {};

		const pane = tabsState.panes?.[paneId];
		const tabId = pane?.tabId;
		const tab = tabId
			? tabsState.tabs?.find((candidate) => candidate.id === tabId)
			: undefined;

		return {
			paneId,
			tabId,
			workspaceId: tab?.workspaceId,
		};
	} catch {
		// App state not initialized yet
	}
	return {};
}

function handleLifecycleEvent(event: LifecycleEvent): void {
	const ids = resolveNotificationIdsFromSession(event.sessionId);
	notificationsEmitter.emit(NOTIFICATION_EVENTS.AGENT_LIFECYCLE, {
		...ids,
		sessionId: event.sessionId,
		eventType: event.eventType,
	});
}

const service = new ChatRuntimeService({
	onLifecycleEvent: handleLifecycleEvent,
});

export const createChatRuntimeServiceRouter = () => service.createRouter();

export type ChatRuntimeServiceDesktopRouter = ReturnType<
	typeof createChatRuntimeServiceRouter
>;
