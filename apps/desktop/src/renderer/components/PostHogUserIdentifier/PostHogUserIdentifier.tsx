import { useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { posthog } from "../../lib/posthog";

export function PostHogUserIdentifier() {
	const { mutate: setUserId } = electronTrpc.analytics.setUserId.useMutation();

	useEffect(() => {
		posthog.reloadFeatureFlags();
		setUserId({ userId: null });
	}, [setUserId]);

	return null;
}
