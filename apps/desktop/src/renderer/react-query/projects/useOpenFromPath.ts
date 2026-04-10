import { electronTrpc } from "renderer/lib/electron-trpc";
import { invalidateWorkspaceQueries } from "renderer/react-query/workspaces/invalidateWorkspaceQueries";

/**
 * Mutation hook for opening a project from a given path
 * Used when dragging folders into the sidebar
 */
export function useOpenFromPath(
	options?: Parameters<
		typeof electronTrpc.projects.openFromPath.useMutation
	>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.projects.openFromPath.useMutation({
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
