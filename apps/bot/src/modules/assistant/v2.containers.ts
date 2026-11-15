import { V2Container, V2Dynamic, V2Section, V2Separator, V2Text, V2When, desc, v2sep, v2text } from '@spraxium/components';

// ── Panneau d'identité (mention nue / salutation) ────────────

export interface IntroData {
  displayName: string;
  staff: boolean;
  avatarUrl: string;
  roleLine: string;
  permsLine: string;
  talkLines: string;
  exampleLines: string;
  memoryLine: string;
}

@V2Container({ accentColor: 0xd95926 })
export class IntroContainer {
  @V2Text((data: IntroData) => desc().h2(`10cordes — agent Discord délégué`))
  title!: never;

  @V2Section({
    text: (data: IntroData) => [data.roleLine, data.permsLine].join('\n'),
    thumbnail: {
      url: (data: IntroData) => data.avatarUrl,
      description: '10cordes',
    },
  })
  who!: never;

  @V2Separator()
  sep1!: never;

  @V2Text((data: IntroData) => `**Parler à l'agent**\n${data.talkLines}`)
  talk!: never;

  @V2Separator()
  sep2!: never;

  @V2Text((data: IntroData) => `**Exemples**\n${data.exampleLines}`)
  examples!: never;

  @V2Separator({ divider: false })
  spacer!: never;

  @V2Text((data: IntroData) => desc().subtext(data.memoryLine))
  footer!: never;
}

// ── Liste des tools, paginée ─────────────────────────────────

export interface ToolCardData {
  name: string;
  description: string;
  category: string;
}

export interface ToolsData {
  intro: string;
  tools: ToolCardData[];
  page: number;
}

export const TOOLS_PER_PAGE = 12;

function groupedEntries(data: ToolsData): Array<ReturnType<typeof v2text>> {
  const pages = Math.max(1, Math.ceil(data.tools.length / TOOLS_PER_PAGE));
  const page = Math.min(Math.max(0, data.page), pages - 1);
  const slice = data.tools.slice(page * TOOLS_PER_PAGE, (page + 1) * TOOLS_PER_PAGE);

  const byCategory = new Map<string, string[]>();
  for (const tool of slice) {
    const names = byCategory.get(tool.category) ?? [];
    const desc = tool.description.length > 80 ? `${tool.description.slice(0, 79)}…` : tool.description;
    names.push(`> **\`${tool.name}\`** — ${desc}`);
    byCategory.set(tool.category, names);
  }

  const children: Array<ReturnType<typeof v2text>> = [];
  for (const [category, names] of byCategory) {
    children.push(v2text(`**${category}**`));
    children.push(v2text(names.join('\n')));
    if (byCategory.size > 1) children.push(v2sep({ divider: false }));
  }
  return children;
}

@V2Container({ accentColor: 0x3987e5 })
export class ToolsListContainer {
  @V2Text((data: ToolsData) => {
    const pages = Math.max(1, Math.ceil(data.tools.length / TOOLS_PER_PAGE));
    return desc().h2(`Tools accessibles — page ${Math.min(data.page + 1, pages)}/${pages}`);
  })
  title!: never;

  @V2When((data: ToolsData) => data.intro.length > 0)
  @V2Text((data: ToolsData) => data.intro)
  intro!: never;

  @V2When((data: ToolsData) => data.intro.length > 0)
  @V2Separator()
  sepIntro!: never;

  @V2Dynamic((data: ToolsData) => groupedEntries(data))
  list!: never;

  @V2Separator({ divider: false })
  spacer!: never;

  @V2Text((data: ToolsData) =>
    desc().subtext(`${data.tools.length} tools filtrés selon tes permissions · navigue avec les boutons`),
  )
  footer!: never;
}

