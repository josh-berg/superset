import { electronTrpc } from "renderer/lib/electron-trpc";
import { invalidateWorkspaceQueries } from "renderer/react-query/workspaces/invalidateWorkspaceQueries";

/**
 * Mutation hook for opening a new project
 * Creates a Project record if it doesn't exist
 */
export function useOpenNew(
	options?: Parameters<typeof electronTrpc.projects.openNew.useMutation>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.projects.openNew.useMutation({
		...options,
		onSuccess: async (...args) => {
			await Promise.all([
				utils.projects.getRecents.invalidate(),
				invalidateWorkspaceQueries(utils),
			]);

			await options?.onSuccess?.(...args);
		},
	});
}
