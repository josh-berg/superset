import {
	ModelSelectorGroup,
	ModelSelectorItem,
	ModelSelectorLogo,
	ModelSelectorName,
} from "@superset/ui/ai-elements/model-selector";
import { claudeIcon } from "@superset/ui/icons/preset-icons";
import type { ModelOption } from "../../../../types";
import {
	ANTHROPIC_LOGO_PROVIDER,
	providerToLogo,
} from "../../utils/providerToLogo";
import { AnthropicProviderHeading } from "./components/AnthropicProviderHeading";

interface ModelProviderGroupProps {
	provider: string;
	models: ModelOption[];
	isAnthropicAuthenticated: boolean;
	isAnthropicOAuthPending: boolean;
	isAnthropicApiKeyPending: boolean;
	onOpenAnthropicAuthModal: () => void;
	onSelectModel: (model: ModelOption) => void;
	onCloseModelSelector: () => void;
}

export function ModelProviderGroup({
	provider,
	models,
	isAnthropicAuthenticated,
	isAnthropicOAuthPending,
	isAnthropicApiKeyPending,
	onOpenAnthropicAuthModal,
	onSelectModel,
	onCloseModelSelector,
}: ModelProviderGroupProps) {
	const groupLogo = providerToLogo(provider);
	const isAnthropicProvider = groupLogo === ANTHROPIC_LOGO_PROVIDER;
	const isConnected = isAnthropicProvider ? isAnthropicAuthenticated : true;
	const heading = isAnthropicProvider
		? `${provider} ${isConnected ? "• Connected" : "• Not connected"}`
		: provider;

	return (
		<ModelSelectorGroup
			key={provider}
			heading={isAnthropicProvider ? undefined : heading}
		>
			{isAnthropicProvider ? (
				<AnthropicProviderHeading
					heading={heading}
					isConnected={isConnected}
					isPending={isAnthropicOAuthPending || isAnthropicApiKeyPending}
					onOpenAuthModal={onOpenAnthropicAuthModal}
				/>
			) : null}

			{models.map((model) => {
				const logo = providerToLogo(model.provider);
				const modelDisabled =
					logo === ANTHROPIC_LOGO_PROVIDER && !isAnthropicAuthenticated;
				const disabledLabel = `${model.provider} (API key or OAuth required)`;

				return (
					<ModelSelectorItem
						key={model.id}
						value={model.id}
						disabled={modelDisabled}
						onSelect={() => {
							onSelectModel(model);
							onCloseModelSelector();
						}}
					>
						{logo === ANTHROPIC_LOGO_PROVIDER ? (
							<img alt="Claude" className="size-3" src={claudeIcon} />
						) : (
							<ModelSelectorLogo provider={logo} />
						)}
						<div className="flex flex-1 flex-col gap-0.5">
							<ModelSelectorName>{model.name}</ModelSelectorName>
							<span className="text-muted-foreground text-xs">
								{modelDisabled ? disabledLabel : model.provider}
							</span>
						</div>
					</ModelSelectorItem>
				);
			})}
		</ModelSelectorGroup>
	);
}
