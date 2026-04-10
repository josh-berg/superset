import { electronTrpc } from "renderer/lib/electron-trpc";
import { invalidateWorkspaceQueries } from "renderer/react-query/workspaces/invalidateWorkspaceQueries";

export function useImportAllWorktrees() {
	const utils = electronTrpc.useUtils();

	return electronTrpc.workspaces.importAllWorktrees.useMutation({
		onSuccess: async () => {
			await invalidateWorkspaceQueries(utils);
			await utils.projects.getRecents.invalidate();
		},
	});
}
