import { cn } from "@superset/ui/utils";
import { LuNetwork } from "react-icons/lu";
import { PROJECT_COLOR_DEFAULT } from "shared/constants/project-colors";
import { useState } from "react";

interface ProjectThumbnailProps {
	projectId: string;
	projectName: string;
	projectColor: string;
	hideImage?: boolean;
	iconUrl?: string | null;
	iconLetter?: string | null;
	isFeatureProject?: boolean;
	className?: string;
}

/**
 * Converts a hex color to rgba with the specified alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Checks if a color value is a custom hex color (not the "default" value).
 */
function isCustomColor(color: string): boolean {
	return color !== PROJECT_COLOR_DEFAULT && color.startsWith("#");
}

export function ProjectThumbnail({
	projectName,
	projectColor,
	hideImage,
	iconUrl,
	iconLetter,
	isFeatureProject = false,
	className,
}: ProjectThumbnailProps) {
	const [iconError, setIconError] = useState(false);

	const displayLetter = iconLetter?.trim()
		? iconLetter.trim().toUpperCase().slice(0, 3)
		: projectName.charAt(0).toUpperCase();
	const hasCustomColor = isCustomColor(projectColor);
	const shouldUseTransparentIconFrame = projectColor === PROJECT_COLOR_DEFAULT;

	// Border: gray by default, custom color with slight transparency when set
	const borderClasses = cn(
		"border-[1.5px]",
		hasCustomColor ? undefined : "border-border",
	);
	const borderStyle = hasCustomColor
		? { borderColor: hexToRgba(projectColor, 0.6) }
		: undefined;

	// Priority 1: Show project icon if available
	if (iconUrl && !iconError && !hideImage) {
		return (
			<div
				className={cn(
					"relative size-6 rounded overflow-hidden flex-shrink-0",
					!shouldUseTransparentIconFrame && "bg-muted",
					!shouldUseTransparentIconFrame && borderClasses,
					shouldUseTransparentIconFrame && "p-[1.5px]",
					className,
				)}
				style={borderStyle}
			>
				<img
					src={iconUrl}
					alt={`${projectName} icon`}
					className="size-full object-cover"
					onError={() => setIconError(true)}
				/>
			</div>
		);
	}

	// Fallback: show first letter
	const fallbackStyle = hasCustomColor
		? {
				borderColor: hexToRgba(projectColor, 0.6),
				backgroundColor: hexToRgba(projectColor, 0.15),
				color: projectColor,
			}
		: borderStyle;

	return (
		<div
			className={cn(
				"size-6 rounded flex items-center justify-center flex-shrink-0",
				"text-xs font-medium",
				hasCustomColor ? undefined : "bg-muted text-muted-foreground",
				borderClasses,
				className,
			)}
			style={fallbackStyle}
		>
			{isFeatureProject ? (
				<LuNetwork className="size-3.5" strokeWidth={1.75} />
			) : (
				displayLetter
			)}
		</div>
	);
}
