import { cn } from "@superset/ui/utils";

interface ProjectThumbnailProps {
	projectName: string;
	className?: string;
}

export function ProjectThumbnail({
	projectName,
	className,
}: ProjectThumbnailProps) {
	const firstLetter = projectName.charAt(0).toUpperCase();

	return (
		<div
			className={cn(
				"size-6 rounded flex items-center justify-center flex-shrink-0",
				"text-xs font-medium bg-muted text-muted-foreground border-[1.5px] border-border",
				className,
			)}
		>
			{firstLetter}
		</div>
	);
}
