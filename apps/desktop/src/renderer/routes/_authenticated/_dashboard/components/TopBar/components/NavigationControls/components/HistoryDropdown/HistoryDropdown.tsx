import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { LuHistory } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	type RecentlyViewedEntry,
	useRecentlyViewed,
} from "./hooks/useRecentlyViewed";

function WorkspaceRow({
	entry,
	isCurrent,
	workspaceData,
	onSelect,
}: {
	entry: RecentlyViewedEntry;
	isCurrent: boolean;
	workspaceData: {
		id: string;
		projectName: string;
		projectColor: string;
		branch: string;
	}[];
	onSelect: () => void;
}) {
	const ws = workspaceData.find((w) => w.id === entry.entityId);

	return (
		<DropdownMenuItem
			className={cn("gap-2.5", isCurrent && "bg-accent/50")}
			onSelect={onSelect}
		>
			{ws ? (
				<>
					<span className="text-muted-foreground text-xs shrink-0 w-20 text-left line-clamp-1">
						Workspace
					</span>
					<span className="flex items-center justify-center w-4 shrink-0">
						<span
							className="size-2 rounded-full"
							style={{ background: ws.projectColor }}
						/>
					</span>
					<span className="truncate text-xs font-normal flex-1 min-w-0">
						{ws.branch}
					</span>
				</>
			) : (
				<>
					<span className="text-muted-foreground text-xs shrink-0 w-20 text-left line-clamp-1">
						Workspace
					</span>
					<span className="truncate text-xs font-normal text-muted-foreground flex-1 min-w-0">
						Unknown
					</span>
				</>
			)}
		</DropdownMenuItem>
	);
}

export function HistoryDropdown() {
	const navigate = useNavigate();
	const recentEntries = useRecentlyViewed(20);
	const currentPath = useLocation({ select: (loc) => loc.pathname });

	const { data: groups } = electronTrpc.workspaces.getAllGrouped.useQuery();
	const workspaceData = (groups ?? []).flatMap((group) =>
		group.workspaces.map((ws) => ({
			id: ws.id,
			projectName: group.project.name,
			projectColor: group.project.color,
			branch: ws.branch ?? ws.name,
		})),
	);

	const filteredEntries = recentEntries.filter((entry) => {
		return workspaceData.some((w) => w.id === entry.entityId);
	});

	if (filteredEntries.length === 0) {
		return (
			<Tooltip delayDuration={300}>
				<TooltipTrigger asChild>
					<button
						type="button"
						disabled
						className="no-drag flex items-center justify-center size-7 rounded-md text-muted-foreground opacity-30"
					>
						<LuHistory className="size-3.5" strokeWidth={1.5} />
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">Recently viewed</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<DropdownMenu>
			<Tooltip delayDuration={300}>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="no-drag flex items-center justify-center size-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
						>
							<LuHistory className="size-3.5" strokeWidth={1.5} />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">Recently viewed</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="w-80">
				<DropdownMenuLabel>Recently Viewed</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{filteredEntries.map((entry) => (
					<WorkspaceRow
						key={entry.path}
						entry={entry}
						isCurrent={entry.path === currentPath}
						workspaceData={workspaceData}
						onSelect={() => navigate({ to: entry.path })}
					/>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
