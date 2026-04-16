import { createContext, type ReactNode, useContext, useEffect } from "react";
import { MOCK_ORG_ID } from "shared/constants";
import { getCollections, preloadCollections } from "./collections";

type CollectionsContextType = ReturnType<typeof getCollections>;

const CollectionsContext = createContext<CollectionsContextType | null>(null);

export function CollectionsProvider({ children }: { children: ReactNode }) {
	useEffect(() => {
		void preloadCollections(MOCK_ORG_ID).catch((error) => {
			console.error(
				"[collections-provider] Failed to preload collections:",
				error,
			);
		});
	}, []);

	const collections = getCollections(MOCK_ORG_ID);

	return (
		<CollectionsContext.Provider value={collections}>
			{children}
		</CollectionsContext.Provider>
	);
}

export function useCollections(): CollectionsContextType {
	const context = useContext(CollectionsContext);
	if (!context) {
		throw new Error("useCollections must be used within CollectionsProvider");
	}
	return context;
}
