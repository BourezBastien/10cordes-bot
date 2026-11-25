import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationView } from '@10cordes/shared';
import { Button } from '@/ds/button';
import { ConfirmDialog } from '@/ds/confirm';
import { Field, SecretInput } from '@/ds/field';
import { Sheet } from '@/ds/sheet';

/*
 * TIROIR DE LA CLÉ D'UN SERVICE. La clé saisie part chiffrée (AES-256-GCM
 * côté bot) et ne revient jamais : le tiroir montre son statut et ses
 * quatre derniers caractères. Une valeur vide conserve la clé actuelle.
 * Une clé propre au serveur peut en être retirée : le service suit de
 * nouveau celle de l'instance.
 */

export interface KeySheetProps {
  service: IntegrationView | null;
  saving: boolean;
  onClose: () => void;
  onSave: (body: { apiKey?: string }) => void;
  onRemove: () => void;
}

export function KeySheet({ service, saving, onClose, onSave, onRemove }: KeySheetProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const slug = service?.slug;

  // Un autre service ouvre le tiroir : la saisie repart à zéro.
  useEffect(() => {
    setValue('');
    setError(null);
    setConfirming(false);
  }, [slug]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError(t('integrations.keySheet.hint'));
      return;
    }
    setError(null);
    onSave({ apiKey: value.trim() });
  };

  return (
    <>
      <Sheet
        open={service !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        locked={saving}
        closeLabel={t('common.close')}
        title={service ? t('integrations.keySheet.title', { name: service.name }) : ''}
        description={t('integrations.keySheet.description')}
      >
        {service ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            {service.key.hasApiKey ? (
              <p className="text-sm text-ink-soft">
                {t('integrations.keySheet.current', { hint: service.key.keyHint ?? '' })}
              </p>
            ) : null}
            <Field label={t('integrations.keySheet.apiKey')} hint={t('integrations.keySheet.hint')} error={error ?? undefined}>
              {(control) => (
                <SecretInput
                  {...control}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError(null);
                  }}
                />
              )}
            </Field>
            <div className="sticky bottom-0 -mx-5 -mb-5 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel px-5 py-4">
              {service.source === 'guild' ? (
                <Button variant="danger" size="sm" disabled={saving} onClick={() => setConfirming(true)}>
                  {t('integrations.keySheet.remove')}
                </Button>
              ) : (
                <span />
              )}
              <span className="flex gap-2">
                <Button variant="ghost" disabled={saving} onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button variant="solid" type="submit" loading={saving}>
                  {t('integrations.keySheet.submit')}
                </Button>
              </span>
            </div>
          </form>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('integrations.keySheet.removeDialog.title')}
        message={service ? t('integrations.keySheet.removeDialog.message', { name: service.name }) : ''}
        confirmLabel={t('integrations.keySheet.remove')}
        cancelLabel={t('common.cancel')}
        busy={saving}
        onConfirm={() => {
          setConfirming(false);
          onRemove();
        }}
      />
    </>
  );
}
