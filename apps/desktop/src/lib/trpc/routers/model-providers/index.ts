import {
	clearProviderIssue,
	getProviderDiagnostic,
} from "lib/ai/provider-diagnostics";
import {
	deriveModelProviderStatus,
	type ProviderId,
} from "shared/ai/provider-status";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { chatService } from "../chat-service";

const providerIdSchema = z.enum(["anthropic"]);

async function getProviderStatuses() {
	const anthropicAuthStatus = await chatService.getAnthropicAuthStatus();

	return [
		deriveModelProviderStatus({
			providerId: "anthropic",
			authStatus: anthropicAuthStatus,
			diagnostic: getProviderDiagnostic("anthropic"),
		}),
	];
}

export const createModelProvidersRouter = () => {
	return router({
		getStatuses: publicProcedure.query(async () => {
			return getProviderStatuses();
		}),
		clearIssue: publicProcedure
			.input(z.object({ providerId: providerIdSchema }))
			.mutation(({ input }: { input: { providerId: ProviderId } }) => {
				clearProviderIssue(input.providerId);
				return { success: true };
			}),
	});
};

export type ModelProvidersRouter = ReturnType<
	typeof createModelProvidersRouter
>;
