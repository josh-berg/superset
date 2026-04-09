import type { ExternalApp } from "@superset/local-db";
import { TabsContent } from "./TabsContent";
import { GroupStrip } from "./TabsContent/GroupStrip";

interface ContentViewProps {
	defaultExternalApp?: ExternalApp | null;
	onOpenInApp: () => void;
	onOpenQuickOpen: () => void;
}

export function ContentView({
	defaultExternalApp,
	onOpenInApp,
	onOpenQuickOpen,
}: ContentViewProps) {
	return (
		<div className="h-full flex flex-col overflow-hidden">
			<GroupStrip />
			<TabsContent
				defaultExternalApp={defaultExternalApp}
				onOpenInApp={onOpenInApp}
				onOpenQuickOpen={onOpenQuickOpen}
			/>
		</div>
	);
}
