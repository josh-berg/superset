import { COMPANY } from "@superset/shared/constants";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import { FaDiscord, FaGithub, FaXTwitter } from "react-icons/fa6";
import {
	HiOutlineBookOpen,
	HiOutlineChatBubbleLeftRight,
	HiOutlineCog6Tooth,
	HiOutlineEnvelope,
} from "react-icons/hi2";
import { IoBugOutline } from "react-icons/io5";
import { LuKeyboard } from "react-icons/lu";
import { useHotkeyDisplay } from "renderer/hotkeys";

export function OrganizationDropdown({
	variant = "topbar",
}: {
	variant?: "topbar" | "expanded" | "collapsed";
}) {
	const navigate = useNavigate();
	const settingsHotkey = useHotkeyDisplay("OPEN_SETTINGS").text;
	const shortcutsHotkey = useHotkeyDisplay("SHOW_HOTKEYS").text;

	function openExternal(url: string): void {
		window.open(url, "_blank");
	}

	const triggerButton =
		variant === "collapsed" ? (
			<button
				type="button"
				className="flex size-8 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-foreground"
				aria-label="App menu"
			>
				<HiOutlineCog6Tooth className="h-4 w-4" />
			</button>
		) : variant === "expanded" ? (
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground min-w-0"
				aria-label="App menu"
			>
				<HiOutlineCog6Tooth className="h-4 w-4 shrink-0" />
				<span className="truncate">Menu</span>
			</button>
		) : (
			<button
				type="button"
				className="no-drag flex items-center gap-1.5 h-6 px-1.5 rounded border border-border/60 bg-secondary/50 hover:bg-secondary hover:border-border transition-all duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-ring"
				aria-label="App menu"
			>
				<HiOutlineCog6Tooth className="h-3.5 w-3.5 text-muted-foreground" />
				<span className="text-xs font-medium">Menu</span>
			</button>
		);

	const contentAlign = variant === "topbar" ? "end" : "start";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
			<DropdownMenuContent align={contentAlign} className="w-56">
				<DropdownMenuItem
					onSelect={() => navigate({ to: "/settings/appearance" })}
				>
					<HiOutlineCog6Tooth className="h-4 w-4" />
					<span>Settings</span>
					{settingsHotkey !== "Unassigned" && (
						<DropdownMenuShortcut>{settingsHotkey}</DropdownMenuShortcut>
					)}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => navigate({ to: "/settings/keyboard" })}
				>
					<LuKeyboard className="h-4 w-4" />
					Keyboard Shortcuts
					{shortcutsHotkey !== "Unassigned" && (
						<DropdownMenuShortcut>{shortcutsHotkey}</DropdownMenuShortcut>
					)}
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem onClick={() => openExternal(COMPANY.DOCS_URL)}>
					<HiOutlineBookOpen className="h-4 w-4" />
					Documentation
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() => openExternal(COMPANY.REPORT_ISSUE_URL)}
				>
					<IoBugOutline className="h-4 w-4" />
					Report Issue
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<HiOutlineChatBubbleLeftRight className="h-4 w-4" />
						Contact Us
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent sideOffset={8} className="w-56">
						<DropdownMenuItem onClick={() => openExternal(COMPANY.GITHUB_URL)}>
							<FaGithub className="h-4 w-4" />
							GitHub
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => openExternal(COMPANY.DISCORD_URL)}>
							<FaDiscord className="h-4 w-4" />
							Discord
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => openExternal(COMPANY.X_URL)}>
							<FaXTwitter className="h-4 w-4" />X
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => openExternal(COMPANY.MAIL_TO)}>
							<HiOutlineEnvelope className="h-4 w-4" />
							Email
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
