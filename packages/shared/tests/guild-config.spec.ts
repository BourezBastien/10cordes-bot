import { describe, expect, it } from 'vitest';
import { CONFIG_KEYS, GuildConfigSchema } from '../src/index.js';

describe('GuildConfigSchema', () => {
  it('fills every field with defaults from an empty document', () => {
    const config = GuildConfigSchema.parse({});
    expect(config.defaultLocale).toBe('fr');
    expect(config.welcome.enabled).toBe(false);
    expect(config.welcome.channelId).toBeNull();
    expect(config.welcome.template).toContain('{{user.mention}}');
    expect(config.welcome.cardEnabled).toBe(false);
    expect(config.moderation.sanctionChannelId).toBeNull();
    expect(config.moderation.muteDerank).toBe(false);
    expect(config.errorMessages).toEqual({});
  });

  it('merges a partial patch with defaults', () => {
    const config = GuildConfigSchema.parse({ welcome: { enabled: true } });
    expect(config.welcome.enabled).toBe(true);
    expect(config.welcome.channelId).toBeNull();
    expect(config.defaultLocale).toBe('fr');
  });

  it('rejects invalid locales', () => {
    expect(() => GuildConfigSchema.parse({ defaultLocale: 'es' })).toThrow();
  });

  it('accepts arbitrary error message overrides', () => {
    const config = GuildConfigSchema.parse({ errorMessages: { MODULE_DISABLED: 'Module éteint : {{label}}' } });
    expect(config.errorMessages.MODULE_DISABLED).toContain('Module éteint');
  });
});

describe('CONFIG_KEYS', () => {
  it('has unique paths', () => {
    const paths = CONFIG_KEYS.map((key) => key.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('only references known top-level groups', () => {
    for (const key of CONFIG_KEYS) {
      expect(
        ['defaultLocale', 'welcome.', 'farewell.', 'moderation.', 'tickets.', 'levels.', 'assistant.', 'security.', 'roles.', 'logs.'].some((prefix) =>
          key.path.startsWith(prefix),
        ),
      ).toBe(true);
    }
  });
});
