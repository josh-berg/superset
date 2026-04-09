import { router } from "../index";
import { chatRouter } from "./chat";
import { filesystemRouter } from "./filesystem";
import { gitRouter } from "./git";
import { githubRouter } from "./github";
import { healthRouter } from "./health";
import { projectRouter } from "./project";
import { pullRequestsRouter } from "./pull-requests";
import { workspaceRouter } from "./workspace";

export const appRouter = router({
	health: healthRouter,
	chat: chatRouter,
	filesystem: filesystemRouter,
	git: gitRouter,
	github: githubRouter,
	pullRequests: pullRequestsRouter,
	project: projectRouter,
	workspace: workspaceRouter,
});

export type AppRouter = typeof appRouter;
