import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { text } from '../../shared/ui';

export interface ToolCard {
  name: string;
  description: string;
  category: string;
}

export interface ToolsPageState {
  tools: ToolCard[];
  page: number;
}

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

const PER_PAGE = 12;

function sep(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

/** Panneau paginé : N tools par page, regroupés par catégorie. */
export function renderToolsPanel(state: ToolsPageState): ContainerBuilder {
  const pages = Math.max(1, Math.ceil(state.tools.length / PER_PAGE));
  const page = Math.min(Math.max(0, state.page), pages - 1);
  const slice = state.tools.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  const byCategory = new Map<string, string[]>();
  for (const tool of slice) {
    const names = byCategory.get(tool.category) ?? [];
    names.push(`**\`${tool.name}\`** — ${tool.description}`);
    byCategory.set(tool.category, names);
  }

  const container = new ContainerBuilder().setAccentColor(0x39_87_e5);
  container.addTextDisplayComponents(
    text(`## 🧰 Tools accessibles — page ${page + 1}/${pages}`),
    text(`*${state.tools.length} tools au total, filtrés selon tes permissions. Pages : ${slice.map((t) => `\`${t.name}\``).join(' ')}*`),
  );
  container.addSeparatorComponents(sep());
  for (const [category, names] of byCategory) {
    container.addTextDisplayComponents(text(`**${category}**\n${names.join('\n')}`));
    container.addSeparatorComponents(sep());
  }
  container.addTextDisplayComponents(text(`-# Utilise ⬅ ➡ pour naviguer (${pages} pages) — ou demande en langage naturel.`));
  return container;
}

export function renderToolsNavRow(hasPrev: boolean, hasNext: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('tools:prev').setLabel('⬅').setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId('tools:next').setLabel('➡').setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
}
