import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { SendHorizontal } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ToolResult {
  name: string;
  ok: boolean;
  summary: string;
}

interface ChatResponse {
  reply: string | null;
  silent: boolean;
  tools: ToolResult[];
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  tools?: ToolResult[];
}

export function AgentPage() {
  const { t } = useTranslation();
  const { guildId } = useParams({ from: '/g/$guildId' });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      api.post<ChatResponse>(`/api/v1/guilds/${guildId}/agent/chat`, { message }),
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status !== 401) {
        const detail = error.details?.[0]?.constraints ? Object.values(error.details[0].constraints)[0] : error.message;
        toast.error(detail);
        return;
      }
      toast.error(t('common.error'));
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, chatMutation.isPending]);

  const send = () => {
    const message = draft.trim();
    if (!message || chatMutation.isPending) return;
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    setDraft('');
    chatMutation.mutate(message, {
      onSuccess: (data) => {
        setTurns((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.silent ? t('agent.silent') : (data.reply ?? ''),
            tools: data.tools,
          },
        ]);
      },
    });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-8">
      <h1 className="mb-4 text-2xl font-semibold">{t('nav.agent')}</h1>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-4">
        {turns.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('agent.empty')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn, index) => (
              <div
                key={index}
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                  turn.role === 'user'
                    ? 'self-end bg-accent/20 border border-line'
                    : 'self-start bg-canvas border border-line',
                )}
              >
                {turn.tools && turn.tools.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {turn.tools.map((tool, toolIndex) => (
                      <span
                        key={toolIndex}
                        title={tool.summary}
                        className={cn(
                          'rounded px-1.5 py-0.5 font-mono text-[10px]',
                          tool.ok ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger',
                        )}
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap">{turn.content}</p>
              </div>
            ))}
            {chatMutation.isPending ? (
              <div className="self-start rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-muted">
                {t('agent.thinking')}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <textarea
          value={draft}
          rows={2}
          className="flex-1 resize-none rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          placeholder={t('agent.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="icon" disabled={chatMutation.isPending || draft.trim().length === 0} onClick={send}>
          <SendHorizontal size={16} />
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{t('agent.note')}</p>
    </div>
  );
}
