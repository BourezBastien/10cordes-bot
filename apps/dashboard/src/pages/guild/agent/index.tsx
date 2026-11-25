import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ds/button';
import { Textarea } from '@/ds/field';
import { Frame } from '@/ds/frame';
import { Empty } from '@/ds/kpi';
import { Process, type ProcessStep } from '@/ds/process';
import { newRequestId, useRequestProgress, type RequestProgress } from '@/lib/progress';
import { api, errorMessage } from '@/lib/api';
import { ChatResultSchema, type ChatTool } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { guildPath } from '@/shell/guild-list';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page } from '@/shell/page';

/*
 * AGENT. Parler au bot depuis le panneau : mêmes outils, mêmes permissions
 * que sur Discord. Une demande montre ses étapes dès que le bot les rend
 * (demande reçue, réflexion, chaque outil appelé, réponse) ; une demande
 * terminée garde les siennes. Entrée envoie, Maj+Entrée passe à la ligne.
 */

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'done' | 'failed';
  tools: ChatTool[];
  requestId: string | null;
}

interface Outcome {
  status: 'done' | 'failed';
  text: string;
  tools: ChatTool[];
}

interface ToolLine {
  name: string;
  ok: boolean;
  summary: string;
}

/** Les étapes d'une réponse : ce qui est connu l'est, le reste attend. */
export function stepsOf(
  turn: Pick<Turn, 'status' | 'tools'>,
  progress: RequestProgress | undefined,
  labels: { received: string; thinking: string; answering: string },
): ProcessStep[] {
  const tools: ToolLine[] = turn.status === 'pending' ? (progress?.steps ?? []) : turn.tools;
  const finished = turn.status !== 'pending';
  return [
    { key: 'received', label: labels.received, state: 'done' },
    { key: 'thinking', label: labels.thinking, state: finished || tools.length > 0 ? 'done' : 'active' },
    ...tools.map((tool, index) => ({
      key: `${tool.name}-${index}`,
      label: tool.name,
      detail: tool.summary || undefined,
      state: tool.ok ? ('done' as const) : ('failed' as const),
    })),
    {
      key: 'answering',
      label: labels.answering,
      state: turn.status === 'done' ? 'done' : turn.status === 'failed' ? 'failed' : tools.length > 0 ? 'active' : 'pending',
    },
  ];
}

export function AgentPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const scroll = useRef<HTMLDivElement>(null);

  const pending = turns.find((turn) => turn.status === 'pending') ?? null;
  const progress = useRequestProgress(guildId, pending?.requestId ?? null, Boolean(pending));

  useEffect(() => {
    const node = scroll.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, progress.dataUpdatedAt]);

  const send = useCallback(() => {
    const message = draft.trim();
    if (!message || pending) return;
    const requestId = newRequestId();
    setTurns((prev) => [
      ...prev,
      { id: `${requestId}-user`, role: 'user', text: message, status: 'done', tools: [], requestId: null },
      { id: requestId, role: 'assistant', text: '', status: 'pending', tools: [], requestId },
    ]);
    setDraft('');
    const finish = (outcome: Outcome) =>
      setTurns((prev) => prev.map((turn) => (turn.id === requestId ? { ...turn, ...outcome } : turn)));
    void api
      .post(guildPath(guildId, '/agent/chat'), { message, requestId }, ChatResultSchema)
      .then((result) =>
        finish({
          status: 'done',
          text: result.silent ? t('agent.silent') : (result.reply ?? ''),
          tools: result.tools,
        }),
      )
      .catch((error: unknown) => finish({ status: 'failed', text: errorMessage(error), tools: [] }));
  }, [draft, pending, guildId, t]);

  const labels = { received: t('agent.received'), thinking: t('agent.thinking'), answering: t('agent.answering') };

  return (
    <Page className="pb-28 md:pb-16">
      <GuildHeader title={t('agent.title')} description={t('agent.description')} />
      <Frame className="flex h-[calc(100dvh-330px)] min-h-96 flex-col">
        <div ref={scroll} className="flex-1 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <div className="pt-10">
              <Empty title={t('agent.empty')} glyph="◆" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {turns.map((turn) => (
                <li key={turn.id} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {turn.role === 'user' ? (
                    <div className="max-w-[85%] border-2 border-accent bg-accent-deep px-4 py-2 text-sm break-words whitespace-pre-wrap text-ink anim-pull">
                      {turn.text}
                    </div>
                  ) : (
                    <div className="w-full border-2 border-line bg-field px-4 py-3 anim-pull">
                      <Process steps={stepsOf(turn, progress.data?.requestId === turn.requestId ? progress.data : undefined, labels)} label={t('agent.steps')} announce={t('agent.done')} />
                      {turn.status !== 'pending' ? (
                        <p className={cn('mt-3 text-sm break-words whitespace-pre-wrap', turn.status === 'failed' ? 'text-danger-soft' : 'text-ink')}>
                          {turn.text}
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-end gap-2 border-t-2 border-line p-3">
          <Textarea
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={t('agent.placeholder')}
            aria-label={t('agent.placeholder')}
            className="min-h-14"
          />
          <Button variant="solid" size="lg" loading={Boolean(pending)} disabled={draft.trim().length === 0} onClick={send}>
            {t('agent.send')}
          </Button>
        </div>
      </Frame>
      <p className="text-desc">{t('agent.note')}</p>
    </Page>
  );
}
