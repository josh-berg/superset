import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@superset/ui/dialog";
import { useState } from "react";
import { HiOutlineVariable } from "react-icons/hi2";

interface EnvVar {
	name: string;
	description: string;
	example?: string;
}

const WORKSPACE_VARS: EnvVar[] = [
	{
		name: "SUPERSET_WORKSPACE_NAME",
		description: "Human-readable workspace name",
		example: "feature/my-branch",
	},
	{
		name: "SUPERSET_BRANCH_NAME",
		description: "Git branch name of this workspace",
		example: "feature/my-branch",
	},
	{
		name: "SUPERSET_REPO_NAME",
		description: "Repository folder name",
		example: "my-repo",
	},
	{
		name: "SUPERSET_FEATURE_PROJECT_NAME",
		description: "Feature project name (multi-repo container), if set",
		example: "My Feature",
	},
	{
		name: "SUPERSET_PROJECT_NAME",
		description: "Single-repo project name",
		example: "my-repo",
	},
	{
		name: "SUPERSET_WORKSPACE_PATH",
		description: "Absolute path to the workspace directory",
		example: "/Users/me/repos/my-repo",
	},
	{
		name: "SUPERSET_ROOT_PATH",
		description: "Absolute path to the repository root",
		example: "/Users/me/repos/my-repo",
	},
	{
		name: "SUPERSET_WORKSPACE_ID",
		description: "Unique workspace identifier",
	},
];

const TERMINAL_VARS: EnvVar[] = [
	{
		name: "SUPERSET_PANE_ID",
		description: "Terminal pane identifier",
	},
	{
		name: "SUPERSET_TAB_ID",
		description: "Terminal tab identifier",
	},
	{
		name: "SUPERSET_PORT",
		description: "Superset runtime notification port",
	},
	{
		name: "SUPERSET_ENV",
		description: 'Environment mode ("development" or "production")',
	},
];

function EnvVarRow({ variable }: { variable: EnvVar }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(`$${variable.name}`);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="group w-full text-left rounded-md px-3 py-2.5 hover:bg-accent/50 transition-colors cursor-pointer"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<code className="text-xs font-mono font-medium text-foreground">
						${variable.name}
					</code>
					<p className="text-xs text-muted-foreground mt-0.5">
						{variable.description}
						{variable.example ? (
							<span className="text-muted-foreground/60">
								{" "}
								— e.g. <em>{variable.example}</em>
							</span>
						) : null}
					</p>
				</div>
				<span className="text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground shrink-0 pt-0.5 transition-colors">
					{copied ? "copied!" : "copy"}
				</span>
			</div>
		</button>
	);
}

export function EnvVarsReference() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
				>
					<HiOutlineVariable className="size-3.5" />
					Variables
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-sm font-medium">
						Available Environment Variables
					</DialogTitle>
					<DialogDescription>
						These variables are set in every terminal session. Click any row to
						copy the variable.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 overflow-y-auto max-h-[60vh] -mx-1 px-1">
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 mb-1 px-3">
							Workspace
						</p>
						<div className="space-y-0.5">
							{WORKSPACE_VARS.map((v) => (
								<EnvVarRow key={v.name} variable={v} />
							))}
						</div>
					</div>

					<div>
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 mb-1 px-3">
							Terminal
						</p>
						<div className="space-y-0.5">
							{TERMINAL_VARS.map((v) => (
								<EnvVarRow key={v.name} variable={v} />
							))}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
