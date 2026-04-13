/**
 * Workspace Service — Desktop Entry Point
 *
 * Starts the host-service HTTP server on a port assigned by the coordinator.
 * The coordinator polls health.check to know when it's ready.
 */

import { serve } from "@hono/node-server";
import {
	createApp,
	JwtApiAuthProvider,
	LocalGitCredentialProvider,
	LocalModelProvider,
	PskHostAuthProvider,
} from "@superset/host-service";
import {
	initTerminalBaseEnv,
	resolveTerminalBaseEnv,
} from "@superset/host-service/terminal-env";
import { connectRelay } from "@superset/host-service/tunnel";
import { removeManifest, writeManifest } from "main/lib/host-service-manifest";
import { env } from "./env";

async function main(): Promise<void> {
	const terminalBaseEnv = await resolveTerminalBaseEnv();
	initTerminalBaseEnv(terminalBaseEnv);

	const authToken = process.env.AUTH_TOKEN;
	const dbPath = process.env.HOST_DB_PATH;
	const deviceClientId = process.env.DEVICE_CLIENT_ID;
	const deviceName = process.env.DEVICE_NAME;
	const hostServiceSecret = process.env.HOST_SERVICE_SECRET;
	const serviceVersion = process.env.HOST_SERVICE_VERSION ?? null;
	const protocolVersion = HOST_SERVICE_PROTOCOL_VERSION;
	const organizationId = process.env.ORGANIZATION_ID ?? "";
	const desktopVitePort = process.env.DESKTOP_VITE_PORT ?? "5173";
	const keepAliveAfterParent = process.env.KEEP_ALIVE_AFTER_PARENT === "1";

	const auth = authToken ? new JwtApiAuthProvider(authToken) : undefined;
	const hostAuth = hostServiceSecret
		? new PskHostAuthProvider(hostServiceSecret)
		: undefined;

	const { app, injectWebSocket } = createApp({
		credentials: new LocalGitCredentialProvider(),
		auth,
		hostAuth,
		dbPath,
		deviceClientId,
		deviceName,
		serviceVersion,
		protocolVersion,
		allowedOrigins: [
			`http://localhost:${desktopVitePort}`,
			`http://127.0.0.1:${desktopVitePort}`,
		],
	});

	const startedAt = Date.now();
	const server = serve(
		{ fetch: app.fetch, port: env.HOST_SERVICE_PORT, hostname: "127.0.0.1" },
		(info: { port: number }) => {
			if (env.ORGANIZATION_ID) {
				try {
					writeManifest({
						pid: process.pid,
						endpoint: `http://127.0.0.1:${info.port}`,
						authToken: env.HOST_SERVICE_SECRET,
						startedAt,
						organizationId: env.ORGANIZATION_ID,
					});
				} catch (error) {
					console.error("[host-service] Failed to write manifest:", error);
				}
			}

			if (env.RELAY_URL && env.ORGANIZATION_ID) {
				void connectRelay({
					api,
					relayUrl: env.RELAY_URL,
					localPort: info.port,
					organizationId: env.ORGANIZATION_ID,
					authProvider,
					hostServiceSecret: env.HOST_SERVICE_SECRET,
				});
			}
		},
	);
	injectWebSocket(server);

	const shutdown = () => {
		if (env.ORGANIZATION_ID) {
			removeManifest(env.ORGANIZATION_ID);
		}
		server.close();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

void main().catch((error) => {
	console.error("[host-service] Failed to start:", error);
	process.exit(1);
});
