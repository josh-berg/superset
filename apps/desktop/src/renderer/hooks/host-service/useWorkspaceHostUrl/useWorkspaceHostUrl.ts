import { useHostService } from "renderer/routes/_authenticated/providers/HostServiceProvider";
import { MOCK_ORG_ID } from "shared/constants";

/**
 * Resolves a workspace ID to its host-service URL.
 * Local-only: always returns the local host service URL.
 */
export function useWorkspaceHostUrl(_workspaceId: string): string | null {
	const { services } = useHostService();
	return services.get(MOCK_ORG_ID)?.url ?? null;
}
