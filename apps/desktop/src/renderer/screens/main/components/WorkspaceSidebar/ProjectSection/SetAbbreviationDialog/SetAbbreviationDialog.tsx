import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { useEffect, useState } from "react";

interface SetAbbreviationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentAbbreviation: string | null;
	onSetAbbreviation: (abbreviation: string | null) => void;
}

export function SetAbbreviationDialog({
	open,
	onOpenChange,
	currentAbbreviation,
	onSetAbbreviation,
}: SetAbbreviationDialogProps) {
	const [value, setValue] = useState(currentAbbreviation ?? "");

	useEffect(() => {
		if (open) {
			setValue(currentAbbreviation ?? "");
		}
	}, [open, currentAbbreviation]);

	const handleSave = () => {
		const trimmed = value.trim().toUpperCase() || null;
		onSetAbbreviation(trimmed);
		onOpenChange(false);
	};

	const handleClear = () => {
		onSetAbbreviation(null);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal={true}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Set Abbreviation</DialogTitle>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="abbreviation-input">
						Abbreviation (1–3 characters)
					</Label>
					<Input
						id="abbreviation-input"
						value={value}
						onChange={(e) => setValue(e.target.value.slice(0, 3))}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleSave();
						}}
						placeholder="e.g. VID"
						className="uppercase text-center"
						maxLength={3}
						autoFocus
					/>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={handleClear} className="mr-auto">
						Clear
					</Button>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave}>Save</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
