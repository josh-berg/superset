import { relations } from "drizzle-orm";

import {
	accounts,
	organizations,
	sessions,
	users,
} from "./auth";
import {
	githubInstallations,
	githubPullRequests,
	githubRepositories,
} from "./github";
import {
	agentCommands,
	chatSessions,
	devicePresence,
	projects,
	sandboxImages,
	secrets,
	sessionHosts,
	taskStatuses,
	tasks,
	v2Clients,
	v2Hosts,
	v2Projects,
	v2UsersHosts,
	v2Workspaces,
	workspaces,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
	sessions: many(sessions),
	accounts: many(accounts),
	createdTasks: many(tasks, { relationName: "creator" }),
	assignedTasks: many(tasks, { relationName: "assignee" }),
	githubInstallations: many(githubInstallations),
	devicePresence: many(devicePresence),
	v2Hosts: many(v2Hosts),
	v2Clients: many(v2Clients),
	v2UsersHosts: many(v2UsersHosts),
	v2Workspaces: many(v2Workspaces),
	agentCommands: many(agentCommands),
	chatSessions: many(chatSessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
	projects: many(projects),
	v2Hosts: many(v2Hosts),
	v2Clients: many(v2Clients),
	v2UsersHosts: many(v2UsersHosts),
	v2Projects: many(v2Projects),
	v2Workspaces: many(v2Workspaces),
	secrets: many(secrets),
	sandboxImages: many(sandboxImages),
	workspaces: many(workspaces),
	tasks: many(tasks),
	taskStatuses: many(taskStatuses),
	githubInstallations: many(githubInstallations),
	githubRepositories: many(githubRepositories),
	githubPullRequests: many(githubPullRequests),
	devicePresence: many(devicePresence),
	agentCommands: many(agentCommands),
	chatSessions: many(chatSessions),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
	organization: one(organizations, {
		fields: [tasks.organizationId],
		references: [organizations.id],
	}),
	status: one(taskStatuses, {
		fields: [tasks.statusId],
		references: [taskStatuses.id],
	}),
	assignee: one(users, {
		fields: [tasks.assigneeId],
		references: [users.id],
		relationName: "assignee",
	}),
	creator: one(users, {
		fields: [tasks.creatorId],
		references: [users.id],
		relationName: "creator",
	}),
}));

export const taskStatusesRelations = relations(
	taskStatuses,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [taskStatuses.organizationId],
			references: [organizations.id],
		}),
		tasks: many(tasks),
	}),
);

// GitHub relations
export const githubInstallationsRelations = relations(
	githubInstallations,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [githubInstallations.organizationId],
			references: [organizations.id],
		}),
		connectedBy: one(users, {
			fields: [githubInstallations.connectedByUserId],
			references: [users.id],
		}),
		repositories: many(githubRepositories),
	}),
);

export const githubRepositoriesRelations = relations(
	githubRepositories,
	({ one, many }) => ({
		installation: one(githubInstallations, {
			fields: [githubRepositories.installationId],
			references: [githubInstallations.id],
		}),
		organization: one(organizations, {
			fields: [githubRepositories.organizationId],
			references: [organizations.id],
		}),
		pullRequests: many(githubPullRequests),
		projects: many(projects),
		v2Projects: many(v2Projects),
	}),
);

export const githubPullRequestsRelations = relations(
	githubPullRequests,
	({ one }) => ({
		repository: one(githubRepositories, {
			fields: [githubPullRequests.repositoryId],
			references: [githubRepositories.id],
		}),
		organization: one(organizations, {
			fields: [githubPullRequests.organizationId],
			references: [organizations.id],
		}),
	}),
);

// Agent relations
export const devicePresenceRelations = relations(devicePresence, ({ one }) => ({
	user: one(users, {
		fields: [devicePresence.userId],
		references: [users.id],
	}),
	organization: one(organizations, {
		fields: [devicePresence.organizationId],
		references: [organizations.id],
	}),
}));

export const agentCommandsRelations = relations(agentCommands, ({ one }) => ({
	user: one(users, {
		fields: [agentCommands.userId],
		references: [users.id],
	}),
	organization: one(organizations, {
		fields: [agentCommands.organizationId],
		references: [organizations.id],
	}),
	parentCommand: one(agentCommands, {
		fields: [agentCommands.parentCommandId],
		references: [agentCommands.id],
		relationName: "parentCommand",
	}),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [projects.organizationId],
		references: [organizations.id],
	}),
	githubRepository: one(githubRepositories, {
		fields: [projects.githubRepositoryId],
		references: [githubRepositories.id],
	}),
	secrets: many(secrets),
	sandboxImage: one(sandboxImages),
	workspaces: many(workspaces),
}));

export const v2ProjectsRelations = relations(v2Projects, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [v2Projects.organizationId],
		references: [organizations.id],
	}),
	githubRepository: one(githubRepositories, {
		fields: [v2Projects.githubRepositoryId],
		references: [githubRepositories.id],
	}),
	workspaces: many(v2Workspaces),
}));

export const v2HostsRelations = relations(v2Hosts, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [v2Hosts.organizationId],
		references: [organizations.id],
	}),
	createdBy: one(users, {
		fields: [v2Hosts.createdByUserId],
		references: [users.id],
	}),
	usersHosts: many(v2UsersHosts),
	workspaces: many(v2Workspaces),
}));

export const v2ClientsRelations = relations(v2Clients, ({ one }) => ({
	organization: one(organizations, {
		fields: [v2Clients.organizationId],
		references: [organizations.id],
	}),
	user: one(users, {
		fields: [v2Clients.userId],
		references: [users.id],
	}),
}));

export const v2UsersHostsRelations = relations(v2UsersHosts, ({ one }) => ({
	organization: one(organizations, {
		fields: [v2UsersHosts.organizationId],
		references: [organizations.id],
	}),
	user: one(users, {
		fields: [v2UsersHosts.userId],
		references: [users.id],
	}),
	host: one(v2Hosts, {
		fields: [v2UsersHosts.hostId],
		references: [v2Hosts.id],
	}),
}));

export const v2WorkspacesRelations = relations(
	v2Workspaces,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [v2Workspaces.organizationId],
			references: [organizations.id],
		}),
		project: one(v2Projects, {
			fields: [v2Workspaces.projectId],
			references: [v2Projects.id],
		}),
		host: one(v2Hosts, {
			fields: [v2Workspaces.hostId],
			references: [v2Hosts.id],
		}),
		createdBy: one(users, {
			fields: [v2Workspaces.createdByUserId],
			references: [users.id],
		}),
		chatSessions: many(chatSessions),
	}),
);

export const secretsRelations = relations(secrets, ({ one }) => ({
	organization: one(organizations, {
		fields: [secrets.organizationId],
		references: [organizations.id],
	}),
	project: one(projects, {
		fields: [secrets.projectId],
		references: [projects.id],
	}),
	createdBy: one(users, {
		fields: [secrets.createdByUserId],
		references: [users.id],
	}),
}));

export const sandboxImagesRelations = relations(sandboxImages, ({ one }) => ({
	organization: one(organizations, {
		fields: [sandboxImages.organizationId],
		references: [organizations.id],
	}),
	project: one(projects, {
		fields: [sandboxImages.projectId],
		references: [projects.id],
	}),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
	organization: one(organizations, {
		fields: [workspaces.organizationId],
		references: [organizations.id],
	}),
	project: one(projects, {
		fields: [workspaces.projectId],
		references: [projects.id],
	}),
	createdBy: one(users, {
		fields: [workspaces.createdByUserId],
		references: [users.id],
	}),
	chatSessions: many(chatSessions),
}));

export const chatSessionsRelations = relations(
	chatSessions,
	({ one, many }) => ({
		organization: one(organizations, {
			fields: [chatSessions.organizationId],
			references: [organizations.id],
		}),
		createdBy: one(users, {
			fields: [chatSessions.createdBy],
			references: [users.id],
		}),
		workspace: one(workspaces, {
			fields: [chatSessions.workspaceId],
			references: [workspaces.id],
		}),
		v2Workspace: one(v2Workspaces, {
			fields: [chatSessions.v2WorkspaceId],
			references: [v2Workspaces.id],
		}),
		sessionHosts: many(sessionHosts),
	}),
);

export const sessionHostsRelations = relations(sessionHosts, ({ one }) => ({
	chatSession: one(chatSessions, {
		fields: [sessionHosts.sessionId],
		references: [chatSessions.id],
	}),
	organization: one(organizations, {
		fields: [sessionHosts.organizationId],
		references: [organizations.id],
	}),
}));
