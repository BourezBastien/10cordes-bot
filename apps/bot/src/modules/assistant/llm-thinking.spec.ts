import { describe, expect, it } from 'vitest';
import {
  endpointAcceptsThinking,
  endpointDisablesThinkingWithNone,
  reasoningEffortValue,
  shouldEnableThinkingForRequest,
} from './llm-thinking';

/**
 * Thinking adaptatif. L'effort de raisonnement d'une requête se décide UNE
 * fois, avant son premier tour : le faire basculer en cours de boucle a
 * coïncidé avec une fuite des balises internes du modèle.
 */

const DEEPSEEK = 'https://api.deepseek.com';

describe('endpointAcceptsThinking · fournisseurs qui acceptent reasoning_effort', () => {
  it('accepte DeepSeek et Anthropic', () => {
    expect(endpointAcceptsThinking(DEEPSEEK)).toBe(true);
    expect(endpointAcceptsThinking('https://api.anthropic.com')).toBe(true);
  });

  it('refuse les autres endpoints et une URL vide', () => {
    expect(endpointAcceptsThinking('https://openrouter.ai/api/v1')).toBe(false);
    expect(endpointAcceptsThinking('https://api.groq.com/openai/v1')).toBe(false);
    expect(endpointAcceptsThinking('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(false);
    expect(endpointAcceptsThinking('')).toBe(false);
  });

  it('exige un vrai domaine (pas un nom qui ressemble)', () => {
    expect(endpointAcceptsThinking('https://fake-deepseek.com/v1')).toBe(false);
  });
});

describe('shouldEnableThinkingForRequest · décision par mode serveur', () => {
  it('off : jamais, même pour une action', () => {
    expect(shouldEnableThinkingForRequest('off', true)).toBe(false);
    expect(shouldEnableThinkingForRequest('off', null)).toBe(false);
  });

  it('always : toujours, même en conversation simple', () => {
    expect(shouldEnableThinkingForRequest('always', false)).toBe(true);
    expect(shouldEnableThinkingForRequest('always', null)).toBe(true);
  });

  it('adaptive : pour TOUTE la requête orientée action, jamais en conversation simple', () => {
    expect(shouldEnableThinkingForRequest('adaptive', true)).toBe(true);
    expect(shouldEnableThinkingForRequest('adaptive', false)).toBe(false);
  });

  it('adaptive : un appel isolé (traduction, curation) ne pense pas', () => {
    expect(shouldEnableThinkingForRequest('adaptive', null)).toBe(false);
  });
});

describe('reasoningEffortValue · valeur envoyée à l\u0027API', () => {
  it('quand on pense : l\u0027effort configuré', () => {
    expect(reasoningEffortValue(DEEPSEEK, true, 'low')).toBe('low');
    expect(reasoningEffortValue('https://openrouter.ai/api/v1', true, 'low')).toBe('low');
  });

  it('chez DeepSeek, couper exige `none` : omettre le champ laisse l\u0027effort par défaut', () => {
    expect(endpointDisablesThinkingWithNone(DEEPSEEK)).toBe(true);
    expect(reasoningEffortValue(DEEPSEEK, false, 'low')).toBe('none');
  });

  it('ailleurs, couper = omettre le champ (jamais de valeur risquée)', () => {
    expect(endpointDisablesThinkingWithNone('https://api.anthropic.com')).toBe(false);
    expect(reasoningEffortValue('https://api.anthropic.com', false, 'low')).toBeNull();
  });
});
