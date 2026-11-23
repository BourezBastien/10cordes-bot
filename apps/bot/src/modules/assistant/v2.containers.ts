import { V2Container, V2Section, V2Separator, V2Text, desc } from '@spraxium/components';

// ── Panneau d'identité (mention nue / salutation) ────────────
// La liste paginée des tools (ToolsListContainer + boutons prev/next) a été
// retirée avec la purge des handlers métier : l'agent répond en conversation,
// les surfaces interactives passent par le moteur générique.

export interface IntroData {
  botName: string;
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
  @V2Text((data: IntroData) => desc().h2(`${data.botName}, ton agent Discord`))
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
