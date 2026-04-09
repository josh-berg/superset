import { normalizeWorkspaceFilePath } from "renderer/components/Chat/ChatInterface/utils/file-paths";
import { FileMentionChip } from "renderer/components/Chat/components/FileMentionChip";
import { parseUserMentions } from "renderer/components/Chat/utils/parseUserMentions";
import type { ChatMessage, ChatMessagePart } from "../../types";

interface UserMessageTextProps {
	message: ChatMessage;
	workspaceCwd?: string;
	onOpenMentionedFile: (filePath: string) => void;
}

export function UserMessageText({
	message,
	workspaceCwd,
	onOpenMentionedFile,
}: UserMessageTextProps) {
	return message.content.map((part: ChatMessagePart, partIndex: number) => {
		if (part.type !== "text") {
			return null;
		}

		const mentionSegments = parseUserMentions(part.text);
		const hasContent = mentionSegments.some(
			(s) => (s.type === "text" && s.value.trim()) || s.type === "file-mention",
		);

		return (
			<div
				key={`${message.id}-${partIndex}`}
				className="flex max-w-[85%] flex-col items-end gap-2"
			>
				{hasContent && (
					<div className="rounded-lg bg-muted px-4 py-2.5 text-sm text-foreground whitespace-pre-wrap">
						{mentionSegments.map((segment, segmentIndex) => {
							if (segment.type === "text") {
								return (
									<span
										key={`${message.id}-${partIndex}-${segmentIndex}`}
										className="whitespace-pre-wrap break-words"
									>
										{segment.value}
									</span>
								);
							}

							if (segment.type === "file-mention") {
								const normalizedPath = normalizeWorkspaceFilePath({
									filePath: segment.relativePath,
									workspaceRoot: workspaceCwd,
								});
								const canOpen = Boolean(normalizedPath);

								return (
									<FileMentionChip
										key={`${message.id}-${partIndex}-${segmentIndex}`}
										relativePath={segment.relativePath}
										disabled={!canOpen}
										onClick={() => {
											if (!normalizedPath) return;
											onOpenMentionedFile(normalizedPath);
										}}
									/>
								);
							}

							return null;
						})}
					</div>
				)}
			</div>
		);
	});
}
