import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { WEBHOOK_AUTH_TYPES, WEBHOOK_METHODS, type WebhookAuthType, type WebhookCreate, type WebhookEndpointView, type WebhookMethod, type WebhookUpdate } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { Field, Input, SecretInput, Textarea, Toggle } from '@/ds';
import { Select } from '@/ds/select';
import { Sheet } from '@/ds/sheet';
import { buildWebhookCreate, buildWebhookUpdate, EMPTY_FORM, formOf, validateWebhook, type FormErrors, type WebhookForm } from './webhooks-form';

/*
 * TIROIR D'UN CONNECTEUR HTTP. Création : nom, slug, méthode, URL cible
 * (https publique : le bot refuse un hôte privé), type d'authentification,
 * jeton (chiffré, jamais relu), en-têtes libres et secrets (JSON), gabarit
 * de la requête (JSON), chemin d'extraction, activation. Édition : mêmes
 * champs hors slug et méthode ; un jeton ou des en-têtes secrets vides sont
 * conservés. Le bot valide tout : le tiroir ne contrôle que la forme.
 */

export type WebhookSession = { mode: 'create' } | { mode: 'edit'; webhook: WebhookEndpointView };

export interface WebhookSheetProps {
  session: WebhookSession | null;
  saving: boolean;
  onClose: () => void;
  onCreate: (body: WebhookCreate) => void;
  onUpdate: (webhookId: string, body: WebhookUpdate) => void;
}

type SheetKey =
  | 'name' | 'slug' | 'slugHint' | 'method' | 'url' | 'urlHint' | 'authType' | 'authHeader' | 'token' | 'tokenCreateHint' | 'tokenEditHint'
  | 'headers' | 'headersHint' | 'secretHeaders' | 'secretHeadersHint' | 'requestTemplate' | 'requestTemplateHint'
  | 'responseExtractPath' | 'responseExtractPathHint' | 'enabled' | 'create' | 'editTitle' | 'createTitle' | 'editDescription' | 'createDescription';

type Props = Omit<WebhookSheetProps, 'session'> & { session: WebhookSession };

function WebhookFields({ session, saving, onClose, onCreate, onUpdate }: Props) {
  const { t } = useTranslation();
  const s = (key: SheetKey) => t(`integrations.webhooks.sheet.${key}`);
  const editing = session.mode === 'edit';
  const webhook = editing ? session.webhook : null;
  const [form, setForm] = useState<WebhookForm>(() => (webhook ? formOf(webhook) : EMPTY_FORM));
  const [errors, setErrors] = useState<FormErrors>({});

  const set = <Key extends keyof WebhookForm>(key: Key, value: WebhookForm[Key]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateWebhook(form, editing, {
      name: t('integrations.webhooks.invalid.name'),
      slug: t('integrations.webhooks.invalid.slug'),
      url: t('integrations.webhooks.invalid.url'),
      header: t('integrations.webhooks.invalid.header'),
      json: t('integrations.webhooks.invalid.json'),
      path: t('integrations.webhooks.invalid.path'),
    });
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (session.mode === 'create') {
      onCreate(buildWebhookCreate(form));
      return;
    }
    const body = buildWebhookUpdate(session.webhook, form);
    if (Object.keys(body).length === 0) {
      toast.info(t('common.noChanges'));
      return;
    }
    onUpdate(session.webhook.webhookId, body);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field label={s('name')} error={errors.name}>
        {(control) => <Input {...control} value={form.name} onChange={(event) => set('name', event.target.value)} autoComplete="off" />}
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={s('slug')} hint={s('slugHint')} error={errors.slug}>
          {(control) => (
            <Input {...control} value={form.slug} readOnly={editing} onChange={(event) => set('slug', event.target.value)} autoComplete="off" spellCheck={false} />
          )}
        </Field>
        <Field label={s('method')}>
          {(control) => (
            <Select
              {...control}
              value={form.method}
              disabled={editing}
              options={WEBHOOK_METHODS.map((method) => ({ value: method, label: method }))}
              onChange={(next) => set('method', next as WebhookMethod)}
            />
          )}
        </Field>
      </div>
      <Field label={s('url')} hint={s('urlHint')} error={errors.url}>
        {(control) => (
          <Input
            {...control}
            value={form.url}
            onChange={(event) => set('url', event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.exemple.com/v1"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={s('authType')}>
          {(control) => (
            <Select
              {...control}
              value={form.authType}
              options={WEBHOOK_AUTH_TYPES.map((auth) => ({ value: auth, label: t(`integrations.webhooks.authTypes.${auth}`) }))}
              onChange={(next) => set('authType', next as WebhookAuthType)}
            />
          )}
        </Field>
        {form.authType === 'header' ? (
          <Field label={s('authHeader')}>
            {(control) => <Input {...control} value={form.authHeaderName} onChange={(event) => set('authHeaderName', event.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
        ) : null}
      </div>
      {form.authType !== 'none' ? (
        <Field label={s('token')} hint={webhook ? `${s('tokenEditHint')} ${secretList(webhook)}` : s('tokenCreateHint')}>
          {(control) => <SecretInput {...control} value={form.token} onChange={(event) => set('token', event.target.value)} />}
        </Field>
      ) : null}
      <Field label={s('headers')} hint={s('headersHint')} error={errors.publicHeaders}>
        {(control) => <Textarea {...control} rows={3} spellCheck={false} value={form.publicHeaders} placeholder='{"X-Org": "valeur"}' onChange={(event) => set('publicHeaders', event.target.value)} />}
      </Field>
      <Field label={s('secretHeaders')} hint={s('secretHeadersHint')} error={errors.secretHeaders}>
        {(control) => <Textarea {...control} rows={3} spellCheck={false} value={form.secretHeaders} placeholder='{"X-Token": "valeur"}' onChange={(event) => set('secretHeaders', event.target.value)} />}
      </Field>
      <Field label={s('requestTemplate')} hint={s('requestTemplateHint')} error={errors.requestTemplate}>
        {(control) => <Textarea {...control} rows={4} spellCheck={false} value={form.requestTemplate} placeholder='{"text": "..."}' onChange={(event) => set('requestTemplate', event.target.value)} />}
      </Field>
      <Field label={s('responseExtractPath')} hint={s('responseExtractPathHint')} error={errors.responseExtractPath}>
        {(control) => (
          <Input {...control} value={form.responseExtractPath} onChange={(event) => set('responseExtractPath', event.target.value)} autoComplete="off" spellCheck={false} placeholder="data.result" />
        )}
      </Field>
      <Toggle checked={form.enabled} onCheckedChange={(next) => set('enabled', next)} label={s('enabled')} />
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-2 flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-4">
        <Button variant="ghost" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="solid" type="submit" loading={saving}>
          {editing ? t('common.save') : s('create')}
        </Button>
      </div>
    </form>
  );
}

function secretList(webhook: WebhookEndpointView): string {
  const { t } = useTranslation();
  const list = webhook.secretHeaderNames.join(', ');
  return t('integrations.webhooks.existingSecrets', { list: list || t('integrations.webhooks.none') });
}

export function WebhookSheet({ session, saving, onClose, onCreate, onUpdate }: WebhookSheetProps) {
  const { t } = useTranslation();
  const editing = session?.mode === 'edit';
  const s = (key: SheetKey) => t(`integrations.webhooks.sheet.${key}`);
  return (
    <Sheet
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      locked={saving}
      size="lg"
      closeLabel={t('common.close')}
      title={editing ? s('editTitle') : s('createTitle')}
      description={editing ? s('editDescription') : s('createDescription')}
    >
      {session ? (
        <WebhookFields
          key={session.mode === 'edit' ? `edit-${session.webhook.webhookId}` : 'create'}
          session={session}
          saving={saving}
          onClose={onClose}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      ) : null}
    </Sheet>
  );
}
