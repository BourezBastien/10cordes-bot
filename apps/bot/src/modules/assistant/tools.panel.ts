
export interface ToolCard {
  name: string;
  description: string;
  category: string;
}

export interface ToolsPageState {
  tools: ToolCard[];
  page: number;
  /** Phrase d'intro de l'agent, réaffichée à chaque page. */
  intro?: string;
}

export const TOOLS_PER_PAGE = 12;

/** État des panneaux de tools paginés, par message (borné). */
const pageStore = new Map<string, ToolsPageState>();
const MAX_STORED = 50;

export function storeToolsPanel(messageId: string, state: ToolsPageState): void {
  if (pageStore.size >= MAX_STORED) {
    const oldest = pageStore.keys().next().value;
    if (oldest) pageStore.delete(oldest);
  }
  pageStore.set(messageId, state);
}

export function getToolsPage(messageId: string): ToolsPageState | undefined {
  return pageStore.get(messageId);
}
