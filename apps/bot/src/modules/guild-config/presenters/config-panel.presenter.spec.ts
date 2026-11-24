import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { ConfigPanelPresenter, type ConfigPanelView } from './config-panel.presenter';

/**
 * Panneau de configuration d\u0027un serveur : ce qui est réellement appliqué,
 * et jamais une clé. La source du fournisseur IA dit la vérité depuis que la
 * configuration vit en base : « en base, chiffrée », et l\u0027environnement
 * seulement le temps de l\u0027import.
 */

function view(overrides: Partial<ConfigPanelView> = {}): ConfigPanelView {
  return {
    guildName: 'Un serveur',
    rulesLines: [],
    skills: { applied: [], appliedTruncated: false, libraryTotal: 135, libraryApplied: 2 },
    integrations: [
      { label: 'PixelLab', connected: true, model: null },
      { label: 'kie.ai (Suno)', connected: true, model: 'V6_MINI' },
    ],
    llm: { connected: true, model: 'deepseek-flash', source: 'db' },
    thinkingMode: 'adaptive',
    threadCreated: true,
    ...overrides,
  };
}

/** Texte des blocs du panneau, dans l\u0027ordre. */
const text = (panel: ConfigPanelView) =>
  new ConfigPanelPresenter()
    .render(panel)
    .components.map((block) => block.data.content)
    .join('\n');

describe('ConfigPanelPresenter', () => {
  it('un payload Components V2', () => {
    expect(new ConfigPanelPresenter().render(view()).flags).toBe(MessageFlags.IsComponentsV2);
  });

  it.each([
    ['db', '(en base, chiffrée)'],
    ['env', '(environnement, en attente d\u0027import en base)'],
    ['none', null],
  ] as const)('source %s : %s', (source, expected) => {
    const rendered = text(view({ llm: { connected: source !== 'none', model: 'deepseek-flash', source } }));
    if (expected) expect(rendered).toContain(`\`deepseek-flash\` ${expected}`);
    else {
      expect(rendered).not.toContain('en base, chiffrée');
      expect(rendered).not.toContain('environnement, en attente');
    }
    expect(rendered).not.toContain('configuré depuis Discord');
    expect(rendered).not.toContain('bootstrap env');
  });

  it('jamais une clé, et les intégrations avec leur modèle', () => {
    const rendered = text(view());
    expect(rendered).toContain('- PixelLab : **connecté**');
    expect(rendered).toContain('`V6_MINI`');
    expect(rendered).toContain('- Agent IA : **connecté** · modèle `deepseek-flash` (en base, chiffrée)');
    expect(rendered).toContain('- Thinking : `adaptive`');
  });

  it('un bouton de connexion seulement quand le fournisseur IA n\u0027est pas connecté', () => {
    const presenter = new ConfigPanelPresenter();
    expect(presenter.renderComplete(view()).components).toHaveLength(presenter.render(view()).components.length);
    expect(presenter.renderComplete(view({ llm: { connected: false, model: null, source: 'none' } })).components).toHaveLength(presenter.render(view()).components.length + 1);
  });
});
