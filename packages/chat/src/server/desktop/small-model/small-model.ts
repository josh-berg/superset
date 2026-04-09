import { createAnthropic } from "@ai-sdk/anthropic";
import {
	type ClaudeCredentials,
	getCredentialsFromAnySource as getAnthropicCredentialsFromAnySource,
	getAnthropicProviderOptions,
} from "../auth/anthropic";

export type SmallModelProviderId = "anthropic";

export interface SmallModelCredential {
	apiKey: string;
	kind: "apiKey" | "oauth";
	source: string;
	expiresAt?: number;
	accountId?: string;
	providerId?: string;
}

export interface SmallModelProvider {
	id: SmallModelProviderId;
	name: string;
	resolveCredentials: () => SmallModelCredential | null;
	isSupported: (credentials: SmallModelCredential) => {
		supported: boolean;
		reason?: string;
	};
	createModel: (
		credentials: SmallModelCredential,
	) => unknown | Promise<unknown>;
}

export function getDefaultSmallModelProviders(): SmallModelProvider[] {
	return [
		{
			id: "anthropic",
			name: "Anthropic",
			resolveCredentials: () => getAnthropicCredentialsFromAnySource(),
			isSupported: () => ({ supported: true }),
			createModel: (credentials) =>
				createAnthropic(
					getAnthropicProviderOptions(credentials as ClaudeCredentials),
				)("claude-haiku-4-5-20251001"),
		},
	];
}
