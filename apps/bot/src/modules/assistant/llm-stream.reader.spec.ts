import { describe, expect, it } from 'vitest';
import { LlmFormatLeakError } from './llm.errors';
import { ChatStreamAccumulator, readChatStream } from './llm-stream.reader';

/**
 * Lecture d'un stream SSE de chat : les tool_calls arrivent en MORCEAUX
 * (id, nom et arguments fragmentés par index). Une réassemblage faux casse
 * chaque appel de tool.
 */

// Clé calculée : sync-tool-names.mjs repère la clé name suivie d'une chaîne.
const NAME = 'name';

const data = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

describe('ChatStreamAccumulator · réassemblage des deltas', () => {
  it('concatène le contenu et pousse chaque delta au callback', () => {
    const accumulator = new ChatStreamAccumulator();
    const deltas: string[] = [];
    accumulator.push(JSON.stringify({ choices: [{ delta: { content: 'Bon' } }] }), (text) => deltas.push(text));
    accumulator.push(JSON.stringify({ choices: [{ delta: { content: 'jour' } }] }), (text) => deltas.push(text));
    expect(accumulator.result()).toMatchObject({ content: 'Bonjour', reasoningContent: null, toolCalls: [] });
    expect(deltas).toEqual(['Bon', 'jour']);
  });

  it('reassemble un tool_call fragmenté par index et ramène le nom à la forme interne', () => {
    const accumulator = new ChatStreamAccumulator();
    accumulator.push(
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { [NAME]: 'records.', arguments: '{"a"' } }] } }],
      }),
    );
    accumulator.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { [NAME]: 'create', arguments: ':1}' } }] } }] }));
    accumulator.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_2', function: { [NAME]: 'translate', arguments: '{}' } }] } }] }));
    expect(accumulator.result().toolCalls).toEqual([
      { id: 'call_1', [NAME]: 'records.create', arguments: '{"a":1}' },
      { id: 'call_2', [NAME]: 'translate', arguments: '{}' },
    ]);
  });

  it('garde le raisonnement des modèles thinking et l\u0027usage de fin de flux', () => {
    const accumulator = new ChatStreamAccumulator();
    accumulator.push(JSON.stringify({ choices: [{ delta: { reasoning_content: 'je pense' } }] }));
    accumulator.push(JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } }));
    expect(accumulator.result()).toMatchObject({ content: null, reasoningContent: 'je pense', usage: { promptTokens: 12, completionTokens: 34 } });
  });

  it('ignore le marqueur de fin et les fragments non JSON', () => {
    const accumulator = new ChatStreamAccumulator();
    accumulator.push('[DONE]');
    accumulator.push('{not json');
    expect(accumulator.result()).toMatchObject({ content: null, toolCalls: [] });
  });
});

describe('readChatStream · fuite de balises internes', () => {
  it('coupe le flux et rejette le tour dès qu\u0027un jeton interne paraît, sans le transmettre au callback', async () => {
    const deltas: string[] = [];
    const events = data({ choices: [{ delta: { content: 'Voici le résultat. ' } }] }) + data({ choices: [{ delta: { content: '<|tool_call|>{"tool":"x"}' } }] }) + data({ choices: [{ delta: { content: 'la suite' } }] });
    await expect(readChatStream(streamOf(events), { onDelta: (text) => deltas.push(text) })).rejects.toBeInstanceOf(LlmFormatLeakError);
    expect(deltas.join('')).toBe('Voici le résultat. ');
  });

  it('un flux normal livre aussi la queue retenue (un « < » final)', async () => {
    const deltas: string[] = [];
    const result = await readChatStream(streamOf(data({ choices: [{ delta: { content: 'a <' } }] })), { onDelta: (text) => deltas.push(text) });
    expect(result.content).toBe('a <');
    expect(deltas.join('')).toBe('a <');
  });
});

describe('readChatStream · découpage SSE', () => {
  it('lit un flux découpé en plein milieu d\u0027une ligne et réarme le watchdog à chaque paquet', async () => {
    let activities = 0;
    const events = data({ choices: [{ delta: { content: 'a' } }] }) + data({ choices: [{ delta: { content: 'b' } }] }) + 'data: [DONE]\n\n';
    // Trois paquets : coupures au milieu d'un JSON et au milieu du marqueur.
    const result = await readChatStream(streamOf(events.slice(0, 20), events.slice(20, 45), events.slice(45)), { onActivity: () => (activities += 1) });
    expect(result.content).toBe('ab');
    expect(activities).toBe(3);
  });

  it('ignore les lignes de commentaire et les cœurs battants', async () => {
    const result = await readChatStream(streamOf(': keep-alive\n\n', data({ choices: [{ delta: { content: 'ok' } }] })));
    expect(result.content).toBe('ok');
  });

  it('renvoie un résultat vide sur un flux fermé immédiatement', async () => {
    expect(await readChatStream(streamOf())).toMatchObject({ content: null, toolCalls: [] });
  });
});
