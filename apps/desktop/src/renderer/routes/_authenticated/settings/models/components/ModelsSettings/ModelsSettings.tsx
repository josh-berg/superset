import { chatServiceTrpc } from "@superset/chat/client";
import { Button } from "@superset/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { Input } from "@superset/ui/input";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { useEffect, useMemo, useState } from "react";
import { HiChevronDown } from "react-icons/hi2";
import { AnthropicOAuthDialog } from "renderer/components/Chat/ChatInterface/components/ModelPicker/components/AnthropicOAuthDialog";
import { useAnthropicOAuth } from "renderer/components/Chat/ChatInterface/components/ModelPicker/hooks/useAnthropicOAuth";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "../../../utils/settings-search";
import { AccountCard } from "./components/AccountCard";
import { ConfigRow } from "./components/ConfigRow";
import { SettingsSection } from "./components/SettingsSection";
import {
	buildAnthropicEnvText,
	EMPTY_ANTHROPIC_FORM,
	getProviderSubtitle,
	getStatusBadge,
	parseAnthropicForm,
	resolveProviderStatus,
} from "./utils";

interface ModelsSettingsProps {
	visibleItems?: SettingItemId[] | null;
}

const DIALOG_CONTEXT = {
	isModelSelectorOpen: true,
	onModelSelectorOpenChange: () => {},
} as const;

export function ModelsSettings({ visibleItems }: ModelsSettingsProps) {
	const showAnthropic = isItemVisible(
		SETTING_ITEM_ID.MODELS_ANTHROPIC,
		visibleItems,
	);
	const [apiKeysOpen, setApiKeysOpen] = useState(true);
	const [overrideOpen, setOverrideOpen] = useState(true);
	const [anthropicApiKeyInput, setAnthropicApiKeyInput] = useState("");
	const [anthropicForm, setAnthropicForm] = useState(EMPTY_ANTHROPIC_FORM);

	const { data: providerStatuses, refetch: refetchProviderStatuses } =
		electronTrpc.modelProviders.getStatuses.useQuery();
	const anthropicDiagnosticStatus = providerStatuses?.find(
		(status) => status.providerId === "anthropic",
	);
	const { data: anthropicAuthStatus, refetch: refetchAnthropicAuthStatus } =
		chatServiceTrpc.auth.getAnthropicStatus.useQuery();
	const { data: anthropicEnvConfig, refetch: refetchAnthropicEnvConfig } =
		chatServiceTrpc.auth.getAnthropicEnvConfig.useQuery();
	const setAnthropicApiKeyMutation =
		chatServiceTrpc.auth.setAnthropicApiKey.useMutation();
	const clearAnthropicApiKeyMutation =
		chatServiceTrpc.auth.clearAnthropicApiKey.useMutation();
	const setAnthropicEnvConfigMutation =
		chatServiceTrpc.auth.setAnthropicEnvConfig.useMutation();
	const clearAnthropicEnvConfigMutation =
		chatServiceTrpc.auth.clearAnthropicEnvConfig.useMutation();
	const clearProviderIssueMutation =
		electronTrpc.modelProviders.clearIssue.useMutation();

	const {
		isStartingOAuth: isStartingAnthropicOAuth,
		startAnthropicOAuth,
		oauthDialog: anthropicOAuthDialog,
	} = useAnthropicOAuth({
		...DIALOG_CONTEXT,
		onAuthStateChange: async () => {
			await Promise.all([
				refetchAnthropicAuthStatus(),
				refetchProviderStatuses(),
			]);
		},
	});

	const hasAnthropicConfig = !!anthropicEnvConfig?.envText.trim().length;
	const isSavingAnthropicApiKey =
		setAnthropicApiKeyMutation.isPending ||
		clearAnthropicApiKeyMutation.isPending;
	const isSavingAnthropicConfig =
		setAnthropicEnvConfigMutation.isPending ||
		clearAnthropicEnvConfigMutation.isPending;

	useEffect(() => {
		setAnthropicForm(parseAnthropicForm(anthropicEnvConfig?.envText ?? ""));
		setAnthropicApiKeyInput("");
	}, [anthropicEnvConfig?.envText]);

	const anthropicStatus = useMemo(
		() =>
			resolveProviderStatus({
				providerId: "anthropic",
				authStatus: anthropicAuthStatus,
				diagnosticStatus: anthropicDiagnosticStatus,
			}),
		[anthropicAuthStatus, anthropicDiagnosticStatus],
	);

	const anthropicSubtitle = useMemo(
		() => getProviderSubtitle("anthropic", anthropicStatus),
		[anthropicStatus],
	);
	const anthropicBadge = useMemo(
		() => getStatusBadge(anthropicStatus),
		[anthropicStatus],
	);

	const clearProviderIssue = () =>
		clearProviderIssueMutation.mutateAsync({ providerId: "anthropic" });

	const saveAnthropicForm = async (nextForm = anthropicForm) => {
		const envText = buildAnthropicEnvText(nextForm);
		try {
			if (envText) {
				await setAnthropicEnvConfigMutation.mutateAsync({ envText });
			} else {
				await clearAnthropicEnvConfigMutation.mutateAsync();
			}
			await Promise.all([
				refetchAnthropicEnvConfig(),
				refetchAnthropicAuthStatus(),
				clearProviderIssue(),
				refetchProviderStatuses(),
			]);
			toast.success("Anthropic settings updated");
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to save");
			return false;
		}
	};

	const saveAnthropicApiKey = async () => {
		const apiKey = anthropicApiKeyInput.trim();
		if (!apiKey) return;
		try {
			await setAnthropicApiKeyMutation.mutateAsync({ apiKey });
			setAnthropicApiKeyInput("");
			await Promise.all([
				refetchAnthropicAuthStatus(),
				clearProviderIssue(),
				refetchProviderStatuses(),
			]);
			toast.success("Anthropic API key updated");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to save");
		}
	};

	const renderAnthropicAction = () => {
		if (!anthropicStatus || anthropicStatus.connectionState === "disconnected") {
			return (
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						void startAnthropicOAuth();
					}}
					disabled={isStartingAnthropicOAuth}
				>
					Connect
				</Button>
			);
		}

		if (anthropicStatus.issue?.remediation === "reconnect") {
			return (
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						void startAnthropicOAuth();
					}}
					disabled={isStartingAnthropicOAuth}
				>
					Reconnect
				</Button>
			);
		}

		if (anthropicOAuthDialog.canDisconnect) {
			return (
				<Button
					variant="ghost"
					size="sm"
					onClick={anthropicOAuthDialog.onDisconnect}
				>
					Logout
				</Button>
			);
		}

		return (
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					void startAnthropicOAuth();
				}}
				disabled={isStartingAnthropicOAuth}
			>
				Connect
			</Button>
		);
	};

	return (
		<>
			<div className="w-full max-w-4xl p-6">
				<div className="mb-8">
					<h2 className="text-xl font-semibold">Models</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage your model accounts, API keys, and provider settings.
					</p>
				</div>

				<div className="space-y-8">
					{showAnthropic ? (
						<SettingsSection title="Anthropic Account">
							<AccountCard
								title="Claude"
								subtitle={anthropicSubtitle}
								badge={anthropicBadge?.label}
								badgeVariant={anthropicBadge?.variant}
								muted={anthropicStatus?.connectionState !== "connected"}
								actions={renderAnthropicAction()}
							/>
						</SettingsSection>
					) : null}

					<Collapsible open={apiKeysOpen} onOpenChange={setApiKeysOpen}>
						<div className="space-y-3">
							<CollapsibleTrigger asChild>
								<button
									type="button"
									className="flex items-center gap-2 text-left text-sm font-semibold"
								>
									<HiChevronDown
										className={`size-4 transition-transform ${apiKeysOpen ? "" : "-rotate-90"}`}
									/>
									API Keys
								</button>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-3">
								{showAnthropic ? (
									<ConfigRow
										title="Anthropic API Key"
										field={
											<Input
												type="password"
												value={anthropicApiKeyInput}
												onChange={(event) => {
													setAnthropicApiKeyInput(event.target.value);
												}}
												placeholder={
													anthropicStatus?.authMethod === "api_key"
														? "Saved Anthropic API key"
														: "sk-ant-..."
												}
												className="font-mono"
												disabled={isSavingAnthropicApiKey}
											/>
										}
										onSave={() => {
											void saveAnthropicApiKey();
										}}
										onClear={() => {
											const nextForm = { ...anthropicForm, apiKey: "" };
											void (async () => {
												try {
													await clearAnthropicApiKeyMutation.mutateAsync();
													setAnthropicApiKeyInput("");
													setAnthropicForm(nextForm);
													await Promise.all([
														refetchAnthropicAuthStatus(),
														clearProviderIssue(),
														refetchProviderStatuses(),
													]);
													toast.success("Anthropic API key cleared");
												} catch (error) {
													toast.error(
														error instanceof Error
															? error.message
															: "Failed to clear",
													);
												}
											})();
										}}
										disableSave={
											isSavingAnthropicApiKey ||
											anthropicApiKeyInput.trim().length === 0
										}
										disableClear={
											isSavingAnthropicApiKey ||
											anthropicStatus?.authMethod !== "api_key"
										}
									/>
								) : null}
							</CollapsibleContent>
						</div>
					</Collapsible>

					{showAnthropic ? (
						<Collapsible open={overrideOpen} onOpenChange={setOverrideOpen}>
							<div className="space-y-3">
								<CollapsibleTrigger asChild>
									<button
										type="button"
										className="flex items-center gap-2 text-left text-sm font-semibold"
									>
										<HiChevronDown
											className={`size-4 transition-transform ${overrideOpen ? "" : "-rotate-90"}`}
										/>
										Override Provider
									</button>
								</CollapsibleTrigger>
								<CollapsibleContent className="space-y-3">
									<ConfigRow
										title="API token"
										description="Anthropic auth token"
										field={
											<Input
												type="password"
												value={anthropicForm.authToken}
												onChange={(event) => {
													setAnthropicForm((current) => ({
														...current,
														authToken: event.target.value,
													}));
												}}
												placeholder="sk-ant-..."
												className="font-mono"
												disabled={isSavingAnthropicConfig}
											/>
										}
										onSave={() => {
											void saveAnthropicForm();
										}}
										onClear={() => {
											const nextForm = { ...anthropicForm, authToken: "" };
											setAnthropicForm(nextForm);
											void saveAnthropicForm(nextForm);
										}}
										disableSave={isSavingAnthropicConfig}
										disableClear={
											isSavingAnthropicConfig ||
											anthropicForm.authToken.length === 0
										}
									/>
									<ConfigRow
										title="Base URL"
										description="Custom API base URL"
										field={
											<Input
												value={anthropicForm.baseUrl}
												onChange={(event) => {
													setAnthropicForm((current) => ({
														...current,
														baseUrl: event.target.value,
													}));
												}}
												placeholder="https://api.anthropic.com"
												className="font-mono"
												disabled={isSavingAnthropicConfig}
											/>
										}
										onSave={() => {
											void saveAnthropicForm();
										}}
										onClear={() => {
											const nextForm = { ...anthropicForm, baseUrl: "" };
											setAnthropicForm(nextForm);
											void saveAnthropicForm(nextForm);
										}}
										disableSave={isSavingAnthropicConfig}
										disableClear={
											isSavingAnthropicConfig ||
											anthropicForm.baseUrl.length === 0
										}
									/>
									<ConfigRow
										title="Additional env"
										description="Extra variables to keep with Anthropic config"
										field={
											<Textarea
												value={anthropicForm.extraEnv}
												onChange={(event) => {
													setAnthropicForm((current) => ({
														...current,
														extraEnv: event.target.value,
													}));
												}}
												placeholder={
													"CLAUDE_CODE_USE_BEDROCK=1\nAWS_REGION=us-east-1"
												}
												className="min-h-24 font-mono text-xs"
												disabled={isSavingAnthropicConfig}
											/>
										}
										onSave={() => {
											void saveAnthropicForm();
										}}
										onClear={
											hasAnthropicConfig
												? () => {
														const nextForm = {
															...anthropicForm,
															extraEnv: "",
														};
														setAnthropicForm(nextForm);
														void saveAnthropicForm(nextForm);
													}
												: undefined
										}
										clearLabel="Clear"
										disableSave={isSavingAnthropicConfig}
										disableClear={
											isSavingAnthropicConfig ||
											anthropicForm.extraEnv.length === 0
										}
									/>
								</CollapsibleContent>
							</div>
						</Collapsible>
					) : null}
				</div>
			</div>

			<AnthropicOAuthDialog {...anthropicOAuthDialog} />
		</>
	);
}
