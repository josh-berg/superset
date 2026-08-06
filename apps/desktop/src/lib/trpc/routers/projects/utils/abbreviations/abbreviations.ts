/**
 * Derives a short abbreviation (1–3 chars) from a project name.
 *
 * Rules:
 * - Strips a leading "hudl-" or "hudl_" prefix, then applies abbreviation to
 *   the remaining parts. A single-word hudl repo (e.g. "hudl-video") uses only
 *   the first letter to match the "first letter of the service name" convention.
 * - For multi-word names (after optional hudl- stripping), takes the first
 *   character of each word, up to 3 total (e.g. "video-player" → "VP").
 * - For non-hudl single-word repos, uses the first 1–3 characters.
 */
export function getAutoProjectAbbreviation(name: string): string {
	const parts = name
		.toLowerCase()
		.split(/[-_\s.]+/)
		.filter((p) => p.length > 0);

	const isHudl = parts[0] === "hudl";
	const effectiveParts = isHudl ? parts.slice(1) : parts;

	if (effectiveParts.length === 0) {
		return name.charAt(0).toUpperCase();
	}

	if (effectiveParts.length === 1) {
		// Hudl single-word service names get just the first letter per convention.
		// Other single-word names use up to 3 chars.
		const word = effectiveParts[0];
		return isHudl
			? word.charAt(0).toUpperCase()
			: word.slice(0, 3).toUpperCase();
	}

	// Multi-word: first char of each word, up to 3
	return effectiveParts
		.slice(0, 3)
		.map((p) => p.charAt(0).toUpperCase())
		.join("");
}
