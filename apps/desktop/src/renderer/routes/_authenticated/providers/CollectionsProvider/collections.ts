import type {
	Collection,
	LocalStorageCollectionUtils,
} from "@tanstack/react-db";
import {
	createCollection,
	localOnlyCollectionOptions,
	localStorageCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
import {
	type DashboardSidebarProjectRow,
	type DashboardSidebarSectionRow,
	dashboardSidebarProjectSchema,
	dashboardSidebarSectionSchema,
	type PendingWorkspaceRow,
	pendingWorkspaceSchema,
	type V2TerminalPresetRow,
	v2TerminalPresetSchema,
	type WorkspaceLocalStateRow,
	workspaceLocalStateSchema,
} from "./dashboardSidebarLocal";

export interface ChatSession {
	id: string;
	title: string | null;
	workspaceId: string | null;
	lastActiveAt: Date | string | null;
	createdAt: Date | string;
}

export interface OrgCollections {
	chatSessions: Collection<ChatSession>;
	v2SidebarProjects: Collection<
		DashboardSidebarProjectRow,
		string,
		LocalStorageCollectionUtils,
		typeof dashboardSidebarProjectSchema,
		z.input<typeof dashboardSidebarProjectSchema>
	>;
	v2WorkspaceLocalState: Collection<
		WorkspaceLocalStateRow,
		string,
		LocalStorageCollectionUtils,
		typeof workspaceLocalStateSchema,
		z.input<typeof workspaceLocalStateSchema>
	>;
	v2SidebarSections: Collection<
		DashboardSidebarSectionRow,
		string,
		LocalStorageCollectionUtils,
		typeof dashboardSidebarSectionSchema,
		z.input<typeof dashboardSidebarSectionSchema>
	>;
	v2TerminalPresets: Collection<
		V2TerminalPresetRow,
		string,
		LocalStorageCollectionUtils,
		typeof v2TerminalPresetSchema,
		z.input<typeof v2TerminalPresetSchema>
	>;
	pendingWorkspaces: Collection<
		PendingWorkspaceRow,
		string,
		LocalStorageCollectionUtils,
		typeof pendingWorkspaceSchema,
		z.input<typeof pendingWorkspaceSchema>
	>;
}

// Per-org collections cache
const collectionsCache = new Map<string, OrgCollections>();

function createOrgCollections(organizationId: string): OrgCollections {
	const chatSessions = createCollection(
		localOnlyCollectionOptions<ChatSession>({
			id: `chat_sessions-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2SidebarProjects = createCollection(
		localStorageCollectionOptions({
			id: `v2_sidebar_projects-${organizationId}`,
			storageKey: `v2-sidebar-projects-${organizationId}`,
			schema: dashboardSidebarProjectSchema,
			getKey: (item) => item.projectId,
		}),
	);

	const v2WorkspaceLocalState = createCollection(
		localStorageCollectionOptions({
			id: `v2_workspace_local_state-${organizationId}`,
			storageKey: `v2-workspace-local-state-${organizationId}`,
			schema: workspaceLocalStateSchema,
			getKey: (item) => item.workspaceId,
		}),
	);

	const v2SidebarSections = createCollection(
		localStorageCollectionOptions({
			id: `v2_sidebar_sections-${organizationId}`,
			storageKey: `v2-sidebar-sections-${organizationId}`,
			schema: dashboardSidebarSectionSchema,
			getKey: (item) => item.sectionId,
		}),
	);

	const v2TerminalPresets = createCollection(
		localStorageCollectionOptions({
			id: `v2_terminal_presets-${organizationId}`,
			storageKey: `v2-terminal-presets-${organizationId}`,
			schema: v2TerminalPresetSchema,
			getKey: (item) => item.id,
		}),
	);

	const pendingWorkspaces = createCollection(
		localStorageCollectionOptions({
			id: `pending_workspaces-${organizationId}`,
			storageKey: `pending-workspaces-${organizationId}`,
			schema: pendingWorkspaceSchema,
			getKey: (item) => item.id,
		}),
	);

	return {
		chatSessions,
		v2SidebarProjects,
		v2WorkspaceLocalState,
		v2SidebarSections,
		v2TerminalPresets,
		pendingWorkspaces,
	};
}

/**
 * No-op in local-only mode — collections are in-memory and require no preloading.
 */
export async function preloadCollections(
	_organizationId: string,
): Promise<void> {}

/**
 * Get collections for an organization, creating them if needed.
 */
export function getCollections(organizationId: string): OrgCollections {
	if (!collectionsCache.has(organizationId)) {
		collectionsCache.set(organizationId, createOrgCollections(organizationId));
	}

	const collections = collectionsCache.get(organizationId);
	if (!collections) {
		throw new Error(`Collections not found for org: ${organizationId}`);
	}

	return collections;
}

export type AppCollections = ReturnType<typeof getCollections>;
