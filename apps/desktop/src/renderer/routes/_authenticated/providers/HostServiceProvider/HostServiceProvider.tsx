import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
} from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { setHostServiceSecret } from "renderer/lib/host-service-auth";
import {
	getHostServiceClient,
	type HostServiceClient,
} from "renderer/lib/host-service-client";
import { MOCK_ORG_ID } from "shared/constants";

export interface OrgService {
	port: number;
	url: string;
	client: HostServiceClient;
}

interface HostServiceContextValue {
	services: Map<string, OrgService>;
}

const HostServiceContext = createContext<HostServiceContextValue | null>(null);

export function HostServiceProvider({ children }: { children: ReactNode }) {
	const utils = electronTrpc.useUtils();

	// Start the single local host service
	useEffect(() => {
		utils.hostServiceManager.getLocalPort
			.ensureData({ organizationId: MOCK_ORG_ID })
			.catch((err) => {
				console.error("[host-service] Failed to start local service:", err);
			});
	}, [utils]);

	const { data: portData } = electronTrpc.hostServiceManager.getLocalPort.useQuery({
		organizationId: MOCK_ORG_ID,
	});

	const services = useMemo(() => {
		const map = new Map<string, OrgService>();
		if (portData?.port) {
			const url = `http://127.0.0.1:${portData.port}`;
			if (portData.secret) {
				setHostServiceSecret(url, portData.secret);
			}
			map.set(MOCK_ORG_ID, {
				port: portData.port,
				url,
				client: getHostServiceClient(portData.port),
			});
		}
		return map;
	}, [portData]);

	const value = useMemo(() => ({ services }), [services]);

	return (
		<HostServiceContext.Provider value={value}>
			{children}
		</HostServiceContext.Provider>
	);
}

export function useHostService(): HostServiceContextValue {
	const context = useContext(HostServiceContext);
	if (!context) {
		throw new Error("useHostService must be used within HostServiceProvider");
	}
	return context;
}
