import { describe, expect, it } from 'vitest';
import { renderTemplate, templateVariables } from '../src/index.js';

describe('renderTemplate', () => {
  it('replaces known variables', () => {
    expect(renderTemplate('Hi {{user.name}}, welcome to {{server.name}}!', {
      'user.name': 'Bastien',
      'server.name': '10cordes',
    })).toBe('Hi Bastien, welcome to 10cordes!');
  });

  it('stringifies numbers', () => {
    expect(renderTemplate('{{memberCount}} members', { memberCount: 42 })).toBe('42 members');
  });

  it('replaces known-but-null variables with an empty string', () => {
    expect(renderTemplate('Hi {{user.name}}!', { 'user.name': null })).toBe('Hi !');
  });

  it('leaves unknown tokens intact for easier debugging', () => {
    expect(renderTemplate('Hi {{user.unknown}}!', {})).toBe('Hi {{user.unknown}}!');
  });

  it('tolerates spaces inside tokens', () => {
    expect(renderTemplate('{{ user.name }}', { 'user.name': 'A' })).toBe('A');
  });
});

describe('templateVariables', () => {
  it('lists unique variables in order of appearance', () => {
    expect(templateVariables('{{a}} {{b}} {{a}} {{ c }}')).toEqual(['a', 'b', 'c']);
  });
});
