import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PROVIDER_AUTH_TYPES, PROVIDER_PROTOCOLS, type ProviderAuthType, type ProviderCreate, type ProviderProtocol, type ProviderUpdate } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { Checkbox, Field, Input, SecretInput, Textarea, Toggle } from '@/ds';
import { Select } from '@/ds/select';
import { Sheet } from '@/ds/sheet';
import { authLabel, protocolLabel } from './labels';
import {
  buildCreate,
  buildUpdate,
  initialForm,
  isAdvanced,
  parseAdvanced,
  validateProvider,
  type Advanced,
  type ProviderErrors,
  type ProviderForm,
  type ProviderSession,
} from './provider-form';

/*
 * TIROIR D'UN FOURNISSEUR. Création : nom, slug (facultatif, déduit du nom),
 * protocole, URL de base, clé (masquée, chiffrée par le bot), type
 * d'authentification, activation, config avancée. Édition : les mêmes
 * champs, sauf le slug ; une clé laissée vide est conservée, une case la
 * retire. Le bot valide tout et refuse une adresse privée : le tiroir ne
 * contrôle que la forme, pour répondre tout de suite.
 */

export type { ProviderSession };

export interface ProviderSheetProps {
  session: ProviderSession | null;
  onClose: () => void;
  saving: boolean;
  onCreate: (body: ProviderCreate) => void;
  onUpdate: (providerId: string, body: ProviderUpdate) => void;
}

function ProviderFields({ session, saving, onClose, onCreate, onUpdate }: Omit<ProviderSheetProps, 'session'> & { session: ProviderSession }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProviderForm>(() => initialForm(session));
  const [errors, setErrors] = useState<ProviderErrors>({});
  const editing = session.mode === 'edit';
  const provider = editing ? session.provider : null;

  const set = <Key extends keyof ProviderForm>(key: Key, value: ProviderForm[Key]) => {
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
    const found = validateProvider(form, t);
    const parsed = parseAdvanced(form.advanced, {
      object: t('providers.sheet.advancedObject'),
      headers: t('providers.sheet.advancedHeaders'),
    });
    // Une config avancée illisible est une erreur de champ ; sinon elle est vide (rien ne change).
    const advanced: Advanced = isAdvanced(parsed) ? parsed : {};
    if (!isAdvanced(parsed)) found.advanced = t('providers.sheet.jsonInvalid', { reason: parsed.error });
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    if (session.mode === 'create') onCreate(buildCreate(form, advanced));
    else onUpdate(session.provider.providerId, buildUpdate(session.provider, form, advanced));
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field label={t('providers.sheet.name')} hint={t('providers.sheet.nameHint')} error={errors.displayName}>
        {(control) => <Input {...control} value={form.displayName} onChange={(event) => set('displayName', event.target.value)} autoComplete="off" />}
      </Field>
      <Field label={t('providers.sheet.slug')} hint={editing ? undefined : t('providers.sheet.slugHint')} error={errors.slug}>
        {(control) => (
          <Input
            {...control}
            value={editing ? session.provider.slug : form.slug}
            readOnly={editing}
            onChange={(event) => set('slug', event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>
      <Field label={t('providers.sheet.protocol')}>
        {(control) => (
          <Select
            {...control}
            value={form.protocol}
            options={PROVIDER_PROTOCOLS.map((protocol) => ({ value: protocol, label: protocolLabel(t, protocol) }))}
            onChange={(next) => set('protocol', next as ProviderProtocol)}
          />
        )}
      </Field>
      <Field label={t('providers.sheet.baseUrl')} hint={t('providers.sheet.baseUrlHint')} error={errors.baseUrl}>
        {(control) => (
          <Input
            {...control}
            value={form.baseUrl}
            onChange={(event) => set('baseUrl', event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.exemple.com/v1"
          />
        )}
      </Field>
      <Field
        label={t('providers.sheet.apiKey')}
        hint={provider?.key.hasApiKey ? t('providers.sheet.apiKeyEditHint', { hint: provider.key.keyHint ?? '' }) : t('providers.sheet.apiKeyCreateHint')}
        error={errors.apiKey}
      >
        {(control) => <SecretInput {...control} value={form.apiKey} onChange={(event) => set('apiKey', event.target.value)} />}
      </Field>
      {provider?.key.hasApiKey ? (
        <Checkbox checked={form.removeKey} onChange={(event) => set('removeKey', event.target.checked)} label={t('providers.sheet.removeKey')} />
      ) : null}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t('providers.sheet.authType')}>
          {(control) => (
            <Select
              {...control}
              value={form.authType}
              options={PROVIDER_AUTH_TYPES.map((auth) => ({ value: auth, label: authLabel(t, auth) }))}
              onChange={(next) => set('authType', next as ProviderAuthType)}
            />
          )}
        </Field>
        {form.authType === 'header' ? (
          <Field label={t('providers.sheet.authHeader')}>
            {(control) => <Input {...control} value={form.authHeaderName} onChange={(event) => set('authHeaderName', event.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
        ) : null}
      </div>
      <Field label={t('providers.sheet.advanced')} hint={t('providers.sheet.advancedHint')} error={errors.advanced}>
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            value={form.advanced}
            onChange={(event) => set('advanced', event.target.value)}
            placeholder='{"customHeaders": {"X-Org": "valeur"}}'
            spellCheck={false}
          />
        )}
      </Field>
      <Toggle checked={form.enabled} onCheckedChange={(next) => set('enabled', next)} label={t('providers.sheet.enabled')} />
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-2 flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-4">
        <Button variant="ghost" disabled={saving} onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="solid" type="submit" loading={saving}>
          {editing ? t('common.save') : t('providers.sheet.create')}
        </Button>
      </div>
    </form>
  );
}

export function ProviderSheet({ session, onClose, saving, onCreate, onUpdate }: ProviderSheetProps) {
  const { t } = useTranslation();
  const editing = session?.mode === 'edit';
  return (
    <Sheet
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      locked={saving}
      closeLabel={t('common.close')}
      title={editing ? t('providers.sheet.editTitle') : t('providers.sheet.createTitle')}
      description={editing ? t('providers.sheet.editDescription') : t('providers.sheet.createDescription')}
    >
      {session ? (
        <ProviderFields
          key={session.mode === 'edit' ? `edit-${session.provider.providerId}` : 'create'}
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
