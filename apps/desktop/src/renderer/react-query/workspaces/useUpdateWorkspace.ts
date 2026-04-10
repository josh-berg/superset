import { electronTrpc } from "renderer/lib/electron-trpc";
import { invalidateWorkspaceQueries } from "renderer/react-query/workspaces/invalidateWorkspaceQueries";

/**
 * Mutation hook for updating a workspace
 * Automatically invalidates all workspace queries on success
 */
export function useUpdateWorkspace(
	options?: Parameters<typeof electronTrpc.workspaces.update.useMutation>[0],
) {
	const utils = electronTrpc.useUtils();

	return electronTrpc.workspaces.update.useMutation({
		...options,
		onSuccess: async (...args) => {
			await invalidateWorkspaceQueries(utils);

			// Call user's onSuccess if provided
			await options?.onSuccess?.(...args);
		},
	});
}
