import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { createMcpServer } from "@superset/mcp";
import type { McpContext } from "@superset/mcp/auth";
import type { verifyAccessToken as verifyOAuthAccessToken } from "better-auth/oauth2";
import { getOAuthProtectedResourceMetadataUrl } from "@/lib/oauth-metadata";

interface SessionUser {
	id: string;
}

interface SessionResponse {
	session?: unknown;
	user: SessionUser;
}

export interface McpRequestDeps {
	apiUrl: string;
	authApi: {
		getSession(args: {
			headers: Headers;
		}): Promise<SessionResponse | null | undefined>;
	};
	createServer: typeof createMcpServer;
	createTransport: () => WebStandardStreamableHTTPServerTransport;
	verifyAccessToken: typeof verifyOAuthAccessToken;
}

function getBearerToken(req: Request): string | undefined {
	const authorization = req.headers.get("authorization");
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1];
}

function normalizeApiUrl(apiUrl: string): string {
	return apiUrl.replace(/\/+$/, "");
}

function getSafeAuthErrorName(error: unknown): string {
	if (error && typeof error === "object") {
		const errorName = "name" in error ? error.name : undefined;
		if (typeof errorName === "string" && errorName.length > 0) {
			return errorName;
		}

		const errorCode = "code" in error ? error.code : undefined;
		if (typeof errorCode === "string" && errorCode.length > 0) {
			return errorCode;
		}
	}

	return "AuthVerificationError";
}

function looksLikeJwt(token: string): boolean {
	const parts = token.split(".");
	return parts.length === 3 && parts.every(Boolean);
}

function buildSessionAuthInfo(session: SessionResponse): AuthInfo {
	return {
		token: "session",
		clientId: "session",
		scopes: ["mcp:full"],
		extra: {
			mcpContext: {
				userId: session.user.id,
				organizationId: "mock-org-id",
			} satisfies McpContext,
		},
	};
}

function buildOAuthAuthInfo(
	bearerToken: string,
	payload: Record<string, unknown>,
): AuthInfo | undefined {
	if (
		typeof payload.sub !== "string" ||
		typeof payload.organizationId !== "string"
	) {
		console.error(
			"[mcp/auth] Access token missing sub or organizationId claim",
		);
		return undefined;
	}

	const scopes = Array.isArray(payload.scope)
		? (payload.scope as string[])
		: typeof payload.scope === "string"
			? payload.scope.split(" ")
			: [];

	return {
		token: bearerToken,
		clientId: typeof payload.azp === "string" ? payload.azp : "mcp-client",
		scopes,
		extra: {
			mcpContext: {
				userId: payload.sub,
				organizationId: payload.organizationId,
			} satisfies McpContext,
		},
	};
}

export async function verifyToken(
	req: Request,
	deps: McpRequestDeps,
): Promise<AuthInfo | undefined> {
	const bearerToken = getBearerToken(req);
	const apiUrl = normalizeApiUrl(deps.apiUrl);
	let oauthVerificationError: unknown;

	if (bearerToken && looksLikeJwt(bearerToken)) {
		try {
			const payload = (await deps.verifyAccessToken(bearerToken, {
				jwksUrl: `${apiUrl}/api/auth/jwks`,
				verifyOptions: {
					issuer: apiUrl,
					audience: [apiUrl, `${apiUrl}/`],
				},
			})) as Record<string, unknown>;

			return buildOAuthAuthInfo(bearerToken, payload);
		} catch (error) {
			oauthVerificationError = error;
		}
	}

	const session = await deps.authApi.getSession({ headers: req.headers });
	if (session?.session) {
		return buildSessionAuthInfo(session);
	}

	if (oauthVerificationError) {
		console.error("[mcp/auth] Access token verification failed", {
			errorName: getSafeAuthErrorName(oauthVerificationError),
		});
	}

	return undefined;
}

export function unauthorizedResponse(req: Request): Response {
	return new Response("Unauthorized", {
		status: 401,
		headers: {
			"WWW-Authenticate": `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(
				req,
			)}"`,
		},
	});
}

export async function handleMcpRequest(
	req: Request,
	deps: McpRequestDeps,
): Promise<Response> {
	const authInfo = await verifyToken(req, deps);
	if (!authInfo) {
		return unauthorizedResponse(req);
	}

	const transport = deps.createTransport();
	const server = deps.createServer();
	await server.connect(transport);

	return transport.handleRequest(req, { authInfo });
}
