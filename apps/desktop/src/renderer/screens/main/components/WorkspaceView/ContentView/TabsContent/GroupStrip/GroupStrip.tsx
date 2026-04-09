import type { TerminalPreset } from "@superset/local-db";
import { eq, or } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { LuPlus } from "react-icons/lu";
import {
	getPresetIcon,
	useIsDarkTheme,
} from "renderer/assets/app-icons/preset-icons";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { usePresets } from "renderer/react-query/presets";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { WorkspaceRunButton } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/WorkspaceRunButton";
import { PRESET_HOTKEY_IDS } from "renderer/routes/_authenticated/_dashboard/workspace/$workspaceId/hooks/usePresetHotkeys";
import { requestTabClose } from "renderer/stores/editor-state/editorCoordinator";
import { useTabsStore } from "renderer/stores/tabs/store";
import { useTabsWithPresets } from "renderer/stores/tabs/useTabsWithPresets";
import {
	isLastPaneInTab,
	resolveActiveTabIdForWorkspace,
} from "renderer/stores/tabs/utils";
import { type ActivePaneStatus, pickHigherStatus } from "shared/tabs-types";
import { PresetBarItem } from "../../components/PresetsBar/components/PresetBarItem";
import { GroupItem } from "./GroupItem";
import { NewTabDropZone } from "./NewTabDropZone";

const NO_WORKSPACE_MATCH = "__no_workspace__";

function isPresetPinnedToBar(pinnedToBar: boolean | undefined): boolean {
	return pinnedToBar !== false;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function getPinnedPresetOrder(
	presets: Array<{ id: string; pinnedToBar?: boolean }>,
): string[] {
	return presets.flatMap((preset) =>
		isPresetPinnedToBar(preset.pinnedToBar) ? [preset.id] : [],
	);
}

function getTargetIndexForPinnedReorder({
	presets,
	pinnedPresetIds,
	presetId,
	targetPinnedIndex,
}: {
	presets: Array<{ id: string }>;
	pinnedPresetIds: string[];
	presetId: string;
	targetPinnedIndex: number;
}): number | null {
	const currentIndex = presets.findIndex((preset) => preset.id === presetId);
	if (currentIndex < 0) return null;

	const previousPinnedId =
		targetPinnedIndex > 0 ? pinnedPresetIds[targetPinnedIndex - 1] : undefined;
	const nextPinnedId =
		targetPinnedIndex < pinnedPresetIds.length - 1
			? pinnedPresetIds[targetPinnedIndex + 1]
			: undefined;

	if (nextPinnedId) {
		const nextIndex = presets.findIndex((preset) => preset.id === nextPinnedId);
		if (nextIndex < 0) return null;
		return currentIndex < nextIndex ? nextIndex - 1 : nextIndex;
	}

	if (previousPinnedId) {
		const previousIndex = presets.findIndex(
			(preset) => preset.id === previousPinnedId,
		);
		if (previousIndex < 0) return null;
		const adjustedPreviousIndex =
			currentIndex < previousIndex ? previousIndex - 1 : previousIndex;
		return adjustedPreviousIndex + 1;
	}

	return currentIndex;
}

export function GroupStrip() {
	const { workspaceId: activeWorkspaceId } = useParams({ strict: false });

	const allTabs = useTabsStore((s) => s.tabs);
	const panes = useTabsStore((s) => s.panes);
	const activeTabIds = useTabsStore((s) => s.activeTabIds);
	const tabHistoryStacks = useTabsStore((s) => s.tabHistoryStacks);
const renameTab = useTabsStore((s) => s.renameTab);
	const setActiveTab = useTabsStore((s) => s.setActiveTab);
	const movePaneToTab = useTabsStore((s) => s.movePaneToTab);
	const movePaneToNewTab = useTabsStore((s) => s.movePaneToNewTab);
	const reorderTabs = useTabsStore((s) => s.reorderTabs);
	const setPaneStatus = useTabsStore((s) => s.setPaneStatus);
	const setTabAutoTitle = useTabsStore((s) => s.setTabAutoTitle);
	const setPaneAutoTitle = useTabsStore((s) => s.setPaneAutoTitle);

	const navigate = useNavigate();
	const isDark = useIsDarkTheme();

	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId },
	);

	const { addTab, openPreset, openPresetInCurrentTerminal } =
		useTabsWithPresets(workspace?.projectId);
	const { presets, matchedPresets, reorderPresets } = usePresets(
		workspace?.projectId,
	);

	// Pinned preset ordering state
	const [localPinnedPresetIds, setLocalPinnedPresetIds] = useState<string[]>(
		() => getPinnedPresetOrder(matchedPresets),
	);

	const pinnedPresets = useMemo(() => {
		const presetById = new Map(
			matchedPresets.map((preset, index) => [preset.id, { preset, index }]),
		);
		const orderedPinnedPresets: Array<{
			preset: (typeof matchedPresets)[number];
			index: number;
		}> = [];
		const seenIds = new Set<string>();

		for (const presetId of localPinnedPresetIds) {
			const item = presetById.get(presetId);
			if (!item) continue;
			if (!isPresetPinnedToBar(item.preset.pinnedToBar)) continue;
			orderedPinnedPresets.push(item);
			seenIds.add(presetId);
		}

		for (const [index, preset] of matchedPresets.entries()) {
			if (!isPresetPinnedToBar(preset.pinnedToBar)) continue;
			if (seenIds.has(preset.id)) continue;
			orderedPinnedPresets.push({ preset, index });
		}

		return orderedPinnedPresets;
	}, [matchedPresets, localPinnedPresetIds]);

	const canOpenInCurrentTerminal = useTabsStore((state) => {
		if (!activeWorkspaceId) return false;
		const activeTabId = resolveActiveTabIdForWorkspace({
			workspaceId: activeWorkspaceId,
			tabs: state.tabs,
			activeTabIds: state.activeTabIds,
			tabHistoryStacks: state.tabHistoryStacks,
		});
		if (!activeTabId) return false;
		const paneId = state.focusedPaneIds[activeTabId];
		if (!paneId) return false;
		return state.panes[paneId]?.type === "terminal";
	});

	const tabs = useMemo(
		() =>
			activeWorkspaceId
				? allTabs.filter((tab) => tab.workspaceId === activeWorkspaceId)
				: [],
		[activeWorkspaceId, allTabs],
	);

	const activeTabId = useMemo(() => {
		if (!activeWorkspaceId) return null;
		return resolveActiveTabIdForWorkspace({
			workspaceId: activeWorkspaceId,
			tabs: allTabs,
			activeTabIds,
			tabHistoryStacks,
		});
	}, [activeWorkspaceId, activeTabIds, allTabs, tabHistoryStacks]);

	const tabStatusMap = useMemo(() => {
		const result = new Map<string, ActivePaneStatus>();
		for (const pane of Object.values(panes)) {
			if (!pane.status || pane.status === "idle") continue;
			const higher = pickHigherStatus(result.get(pane.tabId), pane.status);
			if (higher !== "idle") {
				result.set(pane.tabId, higher);
			}
		}
		return result;
	}, [panes]);

	// Sync session titles → tab and pane names for chat panes in this workspace
	const chatSessionTargets = useMemo(() => {
		const map = new Map<
			string,
			{ tabIds: Set<string>; paneIds: Set<string> }
		>();
		for (const pane of Object.values(panes)) {
			if (pane.type === "chat" && pane.chat?.sessionId) {
				const tab = tabs.find((t) => t.id === pane.tabId);
				if (!tab) continue;
				const sessionId = pane.chat.sessionId;
				const existing = map.get(sessionId) ?? {
					tabIds: new Set<string>(),
					paneIds: new Set<string>(),
				};
				existing.tabIds.add(tab.id);
				existing.paneIds.add(pane.id);
				map.set(sessionId, existing);
			}
		}
		return map;
	}, [panes, tabs]);

	const targetSessionIds = useMemo(
		() => Array.from(chatSessionTargets.keys()),
		[chatSessionTargets],
	);
	const targetSessionIdsKey = targetSessionIds.join(",");
	const shouldSyncChatTitles =
		Boolean(activeWorkspaceId) && targetSessionIds.length > 0;

	const collections = useCollections();
	const { data: chatSessions } = useLiveQuery(
		(q) =>
			q
				.from({ chatSessions: collections.chatSessions })
				.where(({ chatSessions }) => {
					if (!shouldSyncChatTitles) {
						return eq(chatSessions.workspaceId, NO_WORKSPACE_MATCH);
					}
					const [firstSessionId, ...restSessionIds] = targetSessionIds;
					if (!firstSessionId) {
						return eq(chatSessions.workspaceId, NO_WORKSPACE_MATCH);
					}
					let predicate = eq(chatSessions.id, firstSessionId);
					for (const sessionId of restSessionIds) {
						predicate = or(predicate, eq(chatSessions.id, sessionId));
					}
					return predicate;
				})
				.select(({ chatSessions }) => ({
					id: chatSessions.id,
					title: chatSessions.title,
					workspaceId: chatSessions.workspaceId,
				})),
		[collections.chatSessions, shouldSyncChatTitles, targetSessionIdsKey],
	);

	useEffect(() => {
		if (!shouldSyncChatTitles) return;
		if (!chatSessions) return;
		for (const session of chatSessions) {
			const target = chatSessionTargets.get(session.id);
			const title = session.title?.trim();
			if (!target || !title) continue;
			for (const tabId of target.tabIds) {
				setTabAutoTitle(tabId, title);
			}
			for (const paneId of target.paneIds) {
				setPaneAutoTitle(paneId, title);
			}
		}
	}, [
		chatSessions,
		chatSessionTargets,
		setPaneAutoTitle,
		setTabAutoTitle,
		shouldSyncChatTitles,
	]);

	// Sync pinned preset order from server
	useEffect(() => {
		const serverPinnedPresetIds = getPinnedPresetOrder(matchedPresets);
		setLocalPinnedPresetIds((current) =>
			areStringArraysEqual(current, serverPinnedPresetIds)
				? current
				: serverPinnedPresetIds,
		);
	}, [matchedPresets]);

	const handleAddGroup = () => {
		if (!activeWorkspaceId) return;
		addTab(activeWorkspaceId);
	};

const handleOpenPreset = useCallback(
		(preset: TerminalPreset) => {
			if (!activeWorkspaceId) return;
			openPreset(activeWorkspaceId, preset, { target: "active-tab" });
		},
		[activeWorkspaceId, openPreset],
	);

	const handleOpenPresetInCurrentTerminal = useCallback(
		(preset: TerminalPreset) => {
			if (!activeWorkspaceId) return;
			openPresetInCurrentTerminal(activeWorkspaceId, preset);
		},
		[activeWorkspaceId, openPresetInCurrentTerminal],
	);

	const handleOpenPresetInNewTab = useCallback(
		(preset: TerminalPreset) => {
			if (!activeWorkspaceId) return;
			openPreset(activeWorkspaceId, preset, { target: "new-tab" });
		},
		[activeWorkspaceId, openPreset],
	);

	const handleOpenPresetInPane = useCallback(
		(preset: TerminalPreset) => {
			if (!activeWorkspaceId) return;
			openPreset(activeWorkspaceId, preset, {
				target: "active-tab",
				modeOverride: "split-pane",
			});
		},
		[activeWorkspaceId, openPreset],
	);

	const handleEditPreset = useCallback(
		(preset: TerminalPreset) => {
			navigate({
				to: "/settings/terminal",
				search: { editPresetId: preset.id },
			});
		},
		[navigate],
	);

	const handleLocalPinnedReorder = useCallback(
		(fromIndex: number, toIndex: number) => {
			setLocalPinnedPresetIds((current) => {
				if (
					fromIndex < 0 ||
					fromIndex >= current.length ||
					toIndex < 0 ||
					toIndex >= current.length
				) {
					return current;
				}
				const next = [...current];
				const [moved] = next.splice(fromIndex, 1);
				next.splice(toIndex, 0, moved);
				return next;
			});
		},
		[],
	);

	const handlePersistPinnedReorder = useCallback(
		(presetId: string, targetPinnedIndex: number) => {
			const reorderedPinnedPresetIds = [...localPinnedPresetIds];
			const currentPinnedIndex = reorderedPinnedPresetIds.indexOf(presetId);
			if (currentPinnedIndex === -1) return;
			const [moved] = reorderedPinnedPresetIds.splice(currentPinnedIndex, 1);
			reorderedPinnedPresetIds.splice(targetPinnedIndex, 0, moved);

			const targetIndex = getTargetIndexForPinnedReorder({
				presets,
				pinnedPresetIds: reorderedPinnedPresetIds,
				presetId,
				targetPinnedIndex,
			});
			if (targetIndex === null) return;
			reorderPresets.mutate({ presetId, targetIndex });
		},
		[presets, localPinnedPresetIds, reorderPresets],
	);

	const handleSelectGroup = (tabId: string) => {
		if (activeWorkspaceId) setActiveTab(activeWorkspaceId, tabId);
	};

	const handleCloseGroup = (tabId: string) => {
		requestTabClose(tabId);
	};

	const handleRenameGroup = (tabId: string, newName: string) => {
		renameTab(tabId, newName);
	};

	const handleMarkTabAsUnread = (tabId: string) => {
		for (const pane of Object.values(panes)) {
			if (pane.tabId === tabId) {
				setPaneStatus(pane.id, "review");
			}
		}
	};

	const handleReorderTabs = useCallback(
		(fromIndex: number, toIndex: number) => {
			if (activeWorkspaceId) {
				reorderTabs(activeWorkspaceId, fromIndex, toIndex);
			}
		},
		[activeWorkspaceId, reorderTabs],
	);

	const checkIsLastPaneInTab = useCallback((paneId: string) => {
		const freshPanes = useTabsStore.getState().panes;
		const pane = freshPanes[paneId];
		if (!pane) return true;
		return isLastPaneInTab(freshPanes, pane.tabId);
	}, []);

	// Overflow detection for tabs bar
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const tabsTrackRef = useRef<HTMLDivElement>(null);
	const [hasTabOverflow, setHasTabOverflow] = useState(false);

	const updateOverflow = useCallback(() => {
		const container = scrollContainerRef.current;
		const track = tabsTrackRef.current;
		if (!container || !track) return;
		setHasTabOverflow(track.scrollWidth > container.clientWidth + 1);
	}, []);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		const track = tabsTrackRef.current;
		if (!container || !track) return;

		updateOverflow();
		const resizeObserver = new ResizeObserver(updateOverflow);
		resizeObserver.observe(container);
		resizeObserver.observe(track);
		window.addEventListener("resize", updateOverflow);

		return () => {
			resizeObserver.disconnect();
			window.removeEventListener("resize", updateOverflow);
		};
	}, [updateOverflow]);

	useEffect(() => {
		requestAnimationFrame(updateOverflow);
	}, [updateOverflow]);

	return (
		<div className="flex flex-col shrink-0 bg-background">
			{/* Action bar: Terminal | Chat | presets… ··· RunButton */}
			<div className="flex h-10 items-center border-b border-border shrink-0">
				<div className="flex-1 min-w-0">
					<NewTabDropZone
						onDrop={movePaneToNewTab}
						isLastPaneInTab={checkIsLastPaneInTab}
					>
						<div
							className="flex items-center gap-0.5 flex-1 px-1 overflow-x-auto"
							style={{ scrollbarWidth: "none" }}
						>
							{pinnedPresets.map(({ preset, index }, pinnedIndex) => {
								const hotkeyId = PRESET_HOTKEY_IDS[index];
								return (
									<PresetBarItem
										key={preset.id}
										preset={preset}
										pinnedIndex={pinnedIndex}
										hotkeyId={hotkeyId}
										isDark={isDark}
										canOpen={!!activeWorkspaceId}
										canOpenInCurrentTerminal={canOpenInCurrentTerminal}
										onOpenDefault={handleOpenPreset}
										onOpenInCurrentTerminal={handleOpenPresetInCurrentTerminal}
										onOpenInNewTab={handleOpenPresetInNewTab}
										onOpenInPane={handleOpenPresetInPane}
										onEdit={handleEditPreset}
										onLocalReorder={handleLocalPinnedReorder}
										onPersistReorder={handlePersistPinnedReorder}
									/>
								);
							})}
						</div>
					</NewTabDropZone>
				</div>
				{activeWorkspaceId && (
					<div className="flex items-center px-2 shrink-0 border-l border-border h-full">
						<WorkspaceRunButton
							projectId={workspace?.projectId ?? workspace?.project?.id}
							workspaceId={activeWorkspaceId}
							worktreePath={workspace?.worktreePath}
						/>
					</div>
				)}
			</div>

			{/* Tabs bar */}
			<div className="flex h-10 min-w-0 items-stretch border-b border-border shrink-0">
				<div
					ref={scrollContainerRef}
					className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
					style={{ scrollbarWidth: "none" }}
				>
					<div ref={tabsTrackRef} className="flex items-stretch">
						{tabs.map((tab, index) => (
							<div
								key={tab.id}
								className="h-full shrink-0"
								style={{ width: "160px" }}
							>
								<GroupItem
									tab={tab}
									index={index}
									isActive={tab.id === activeTabId}
									status={tabStatusMap.get(tab.id) ?? null}
									onSelect={() => handleSelectGroup(tab.id)}
									onClose={() => handleCloseGroup(tab.id)}
									onRename={(newName) => handleRenameGroup(tab.id, newName)}
									onMarkAsUnread={() => handleMarkTabAsUnread(tab.id)}
									onPaneDrop={(paneId) => movePaneToTab(paneId, tab.id)}
									onReorder={handleReorderTabs}
								/>
							</div>
						))}
						<button
							type="button"
							onClick={handleAddGroup}
							className="flex items-center justify-center px-2 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
							aria-label="New terminal tab"
						>
							<LuPlus className="size-3.5" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
