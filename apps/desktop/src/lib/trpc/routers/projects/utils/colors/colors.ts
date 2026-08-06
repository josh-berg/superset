import {
	PROJECT_COLOR_DEFAULT,
	PROJECT_COLOR_VALUES,
} from "shared/constants/project-colors";

/**
 * Returns the default color for new projects.
 * Projects start with no custom color (gray border).
 */
export function getDefaultProjectColor(): string {
	return PROJECT_COLOR_DEFAULT;
}

/**
 * Picks a project color that isn't already in use by existing projects.
 * Falls back to cycling through the palette if all colors are taken.
 */
export function getAutoProjectColor(existingColors: string[]): string {
	const usedSet = new Set(
		existingColors.filter((c) => c !== PROJECT_COLOR_DEFAULT),
	);
	const available = PROJECT_COLOR_VALUES.find((v) => !usedSet.has(v));
	if (available) return available;
	// All colors used — cycle by total project count
	return PROJECT_COLOR_VALUES[
		existingColors.length % PROJECT_COLOR_VALUES.length
	];
}
