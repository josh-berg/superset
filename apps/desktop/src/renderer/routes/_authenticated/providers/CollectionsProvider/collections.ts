import type {
	SelectAgentCommand,
	SelectChatSession,
	SelectGithubPullRequest,
	SelectGithubRepository,
	SelectProject,
	SelectTask,
	SelectTaskStatus,
	SelectUser,
	SelectV2Client,
	SelectV2Host,
	SelectV2Project,
	SelectV2UsersHosts,
	SelectV2Workspace,
	SelectWorkspace,
} from "@superset/db/schema";
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
	type WorkspaceLocalStateRow,
	workspaceLocalStateSchema,
} from "./dashboardSidebarLocal";

export interface OrgCollections {
	tasks: Collection<SelectTask>;
	taskStatuses: Collection<SelectTaskStatus>;
	projects: Collection<SelectProject>;
	v2Hosts: Collection<SelectV2Host>;
	v2Clients: Collection<SelectV2Client>;
	v2UsersHosts: Collection<SelectV2UsersHosts>;
	v2Projects: Collection<SelectV2Project>;
	v2Workspaces: Collection<SelectV2Workspace>;
	workspaces: Collection<SelectWorkspace>;
	users: Collection<SelectUser>;
	agentCommands: Collection<SelectAgentCommand>;
	chatSessions: Collection<SelectChatSession>;
	githubRepositories: Collection<SelectGithubRepository>;
	githubPullRequests: Collection<SelectGithubPullRequest>;
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
}

// Per-org collections cache
const collectionsCache = new Map<string, OrgCollections>();

function createOrgCollections(organizationId: string): OrgCollections {
	const tasks = createCollection(
		localOnlyCollectionOptions<SelectTask>({
			id: `tasks-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const taskStatuses = createCollection(
		localOnlyCollectionOptions<SelectTaskStatus>({
			id: `task_statuses-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const projects = createCollection(
		localOnlyCollectionOptions<SelectProject>({
			id: `projects-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2Projects = createCollection(
		localOnlyCollectionOptions<SelectV2Project>({
			id: `v2_projects-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2Hosts = createCollection(
		localOnlyCollectionOptions<SelectV2Host>({
			id: `v2_hosts-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2Clients = createCollection(
		localOnlyCollectionOptions<SelectV2Client>({
			id: `v2_clients-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2UsersHosts = createCollection(
		localOnlyCollectionOptions<SelectV2UsersHosts>({
			id: `v2_users_hosts-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const v2Workspaces = createCollection(
		localOnlyCollectionOptions<SelectV2Workspace>({
			id: `v2_workspaces-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const workspaces = createCollection(
		localOnlyCollectionOptions<SelectWorkspace>({
			id: `workspaces-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const users = createCollection(
		localOnlyCollectionOptions<SelectUser>({
			id: `users-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const agentCommands = createCollection(
		localOnlyCollectionOptions<SelectAgentCommand>({
			id: `agent_commands-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const chatSessions = createCollection(
		localOnlyCollectionOptions<SelectChatSession>({
			id: `chat_sessions-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const githubRepositories = createCollection(
		localOnlyCollectionOptions<SelectGithubRepository>({
			id: `github_repositories-${organizationId}`,
			getKey: (item) => item.id,
		}),
	);

	const githubPullRequests = createCollection(
		localOnlyCollectionOptions<SelectGithubPullRequest>({
			id: `github_pull_requests-${organizationId}`,
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

	return {
		tasks,
		taskStatuses,
		projects,
		v2Hosts,
		v2Clients,
		v2UsersHosts,
		v2Projects,
		v2Workspaces,
		workspaces,
		users,
		agentCommands,
		chatSessions,
		githubRepositories,
		githubPullRequests,
		v2SidebarProjects,
		v2WorkspaceLocalState,
		v2SidebarSections,
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
