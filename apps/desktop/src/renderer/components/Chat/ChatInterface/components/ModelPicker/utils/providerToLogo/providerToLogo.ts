export const ANTHROPIC_LOGO_PROVIDER = "anthropic";

/** Derive a logo provider slug from the provider name */
export function providerToLogo(provider: string): string {
	const lower = provider.toLowerCase();
	if (lower.includes("anthropic") || lower.includes("claude")) {
		return ANTHROPIC_LOGO_PROVIDER;
	}
	return lower;
}
