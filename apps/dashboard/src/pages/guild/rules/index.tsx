import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { GuildRules } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { Field, Textarea, Toggle } from '@/ds';
import { Panel } from '@/ds/frame';
import { errorMessage } from '@/lib/api';
import { useChannels } from '@/lib/queries';
import { useGuild } from '@/shell/guild-context';
import { GuildHeader } from '@/shell/guild-header';
import { Page, QueryState } from '@/shell/page';
import { buildPatch, countChanges, useRules, useSaveRules } from './api';
import { ChannelPicker, toggled } from './channel-picker';

/*
 * RÈGLES DU SERVEUR. Les mêmes que l'outil rules.set, en vigueur dans la
 * barrière, le registre et le prompt : zones libres (catégories et salons,
 * deux sélections), silence total (des salons seulement : la barrière ne
 * connaît que des salons), mention stricte, demandes sérieuses, confirmation
 * des actions, consignes. Les changements se cumulent et s'enregistrent
 * ensemble.
 */

const INSTRUCTION_MIN = 3;

function RuleRow({ title, hint, name, checked, onChange }: { title: string; hint: string; name: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
      </div>
      <Toggle checked={checked} onCheckedChange={onChange} label={name} />
    </div>
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  const { guildId } = useGuild();
  const rules = useRules(guildId);
  const channels = useChannels(guildId);
  const save = useSaveRules(guildId);
  const [overrides, setOverrides] = useState<Partial<GuildRules>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [instructionError, setInstructionError] = useState<string | null>(null);

  const set = <Key extends keyof GuildRules>(key: Key, value: GuildRules[Key]) => setOverrides((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setOverrides({});
    setAdded([]);
    setRemoved([]);
    setInstruction('');
    setInstructionError(null);
  };

  const addInstruction = () => {
    const text = instruction.trim();
    if (text.length < INSTRUCTION_MIN) {
      setInstructionError(t('rules.tooShort'));
      return;
    }
    setAdded((prev) => [...prev, text]);
    setRemoved((prev) => prev.filter((item) => item !== text));
    setInstruction('');
    setInstructionError(null);
  };

  const removeInstruction = (text: string) => {
    if (added.includes(text)) setAdded((prev) => prev.filter((item) => item !== text));
    else setRemoved((prev) => [...prev, text]);
  };

  const submit = (base: GuildRules, draft: GuildRules) => {
    const patch = buildPatch(base, draft, added, removed);
    if (!patch) {
      toast.info(t('common.noChanges'));
      return;
    }
    save.mutate(patch, {
      onSuccess: () => {
        toast.success(t('rules.saved'));
        reset();
      },
      onError: (error: unknown) => toast.error(errorMessage(error)),
    });
  };

  return (
    <Page>
      <GuildHeader
        title={t('rules.title')}
        description={t('rules.description')}
        actions={
          <>
            <Button variant="ghost" disabled={save.isPending} onClick={reset}>
              {t('config.reset')}
            </Button>
            <Button variant="solid" loading={save.isPending} onClick={() => rules.data && submit(rules.data, { ...rules.data, ...overrides })}>
              {t('common.save')}
            </Button>
          </>
        }
      />
      <QueryState query={rules} label={t('common.loading')}>
        {(base) => {
          const draft: GuildRules = { ...base, ...overrides };
          const changes = countChanges(base, draft, added, removed);
          const instructions = [...draft.customInstructions.filter((item) => !removed.includes(item)), ...added];
          const list = channels.data?.channels ?? [];
          return (
            <>
              {changes > 0 ? (
                <p role="status" className="text-desc text-accent-soft">
                  {t('config.changed', { count: changes })}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-4">
                  <Panel title={t('rules.free')} label={t('rules.selected', { count: draft.freeCategoryIds.length + draft.freeChannelIds.length })}>
                    <p className="text-desc mb-3">{t('rules.freeHint')}</p>
                    <ChannelPicker
                      label={`${t('rules.free')} : ${t('rules.channels')}`}
                      channels={list}
                      loading={channels.isPending}
                      empty={t('rules.noChannels')}
                      selectedCategories={new Set(draft.freeCategoryIds)}
                      selectedChannels={new Set(draft.freeChannelIds)}
                      onCategory={(id) => set('freeCategoryIds', [...toggled(new Set(draft.freeCategoryIds), id)])}
                      onChannel={(id) => set('freeChannelIds', [...toggled(new Set(draft.freeChannelIds), id)])}
                    />
                  </Panel>
                  <Panel title={t('rules.blocked')} label={t('rules.selected', { count: draft.blockedChannelIds.length })}>
                    <p className="text-desc mb-3">{t('rules.blockedHint')}</p>
                    <ChannelPicker
                      categoriesSelectable={false}
                      label={`${t('rules.blocked')} : ${t('rules.channels')}`}
                      channels={list}
                      loading={channels.isPending}
                      empty={t('rules.noChannels')}
                      selectedCategories={new Set()}
                      selectedChannels={new Set(draft.blockedChannelIds)}
                      onCategory={() => undefined}
                      onChannel={(id) => set('blockedChannelIds', [...toggled(new Set(draft.blockedChannelIds), id)])}
                    />
                  </Panel>
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <Panel title={t('rules.behaviour')}>
                    <RuleRow title={t('rules.strictMention')} hint={t('rules.strictMentionHint')} name={t('rules.strictMention')} checked={draft.strictMentionElsewhere} onChange={(next) => set('strictMentionElsewhere', next)} />
                    <RuleRow title={t('rules.seriousOnly')} hint={t('rules.seriousOnlyHint')} name={t('rules.seriousOnly')} checked={draft.seriousOnlyElsewhere} onChange={(next) => set('seriousOnlyElsewhere', next)} />
                    <RuleRow title={t('rules.confirm')} hint={t('rules.confirmHint')} name={t('rules.confirm')} checked={draft.confirmDestructiveActions} onChange={(next) => set('confirmDestructiveActions', next)} />
                  </Panel>
                  <Panel title={t('rules.instructions')}>
                    <p className="text-desc mb-3">{t('rules.instructionsHint')}</p>
                    <Field label={t('rules.instructionField')} error={instructionError}>
                      {(control) => (
                        <Textarea
                          {...control}
                          rows={2}
                          value={instruction}
                          maxLength={300}
                          placeholder={t('rules.instructionPlaceholder')}
                          onChange={(event) => {
                            setInstruction(event.target.value);
                            setInstructionError(null);
                          }}
                        />
                      )}
                    </Field>
                    <div className="mt-3">
                      <Button size="sm" onClick={addInstruction}>
                        {t('rules.addInstruction')}
                      </Button>
                    </div>
                    <ul className="mt-4 flex flex-col gap-2">
                      {instructions.length === 0 ? (
                        <li className="text-sm text-ink-faint">{t('rules.noInstructions')}</li>
                      ) : (
                        instructions.map((text) => (
                          <li key={text} className="flex items-start justify-between gap-3 border-2 border-line bg-field px-3 py-2">
                            <span className="min-w-0 text-sm break-words text-ink-soft">{text}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-my-1.5 shrink-0 text-base leading-none text-ink-faint enabled:hover:text-danger-soft"
                              aria-label={`${t('rules.removeInstruction')} : ${text}`}
                              title={t('rules.removeInstruction')}
                              onClick={() => removeInstruction(text)}
                            >
                              ×
                            </Button>
                          </li>
                        ))
                      )}
                    </ul>
                  </Panel>
                </div>
              </div>
            </>
          );
        }}
      </QueryState>
    </Page>
  );
}
