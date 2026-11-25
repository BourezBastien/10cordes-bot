import type { ProviderAuthType, ProviderCreate, ProviderProtocol, ProviderUpdate, ProviderView } from '@10cordes/shared';
import type { TFunction } from 'i18next';
import { isPublicHttpsUrl } from '@/lib/url';

/*
 * FORMULAIRE D'UN FOURNISSEUR, sans rendu : état, lecture de la config
 * avancée, contrôle de forme, et corps des écritures. En édition, seuls les
 * champs qui changent partent ; une clé laissée vide est conservée, une case
 * la retire.
 */

export type ProviderSession = { mode: 'create' } | { mode: 'edit'; provider: ProviderView };

export interface ProviderForm {
  displayName: string;
  slug: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  authType: ProviderAuthType;
  authHeaderName: string;
  enabled: boolean;
  advanced: string;
  removeKey: boolean;
}

export type ProviderErrors = Partial<Record<keyof ProviderForm, string>>;

/** Saisie vierge : création, et socle de l'édition. */
export const EMPTY_FORM: ProviderForm = {
  displayName: '',
  slug: '',
  protocol: 'openai-chat',
  baseUrl: '',
  apiKey: '',
  authType: 'bearer',
  authHeaderName: '',
  enabled: true,
  advanced: '',
  removeKey: false,
};

const SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/u;

export function initialForm(session: ProviderSession): ProviderForm {
  if (session.mode === 'create') return EMPTY_FORM;
  const { provider } = session;
  return {
    ...EMPTY_FORM,
    displayName: provider.displayName,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    authType: provider.authType,
    authHeaderName: provider.authHeaderName ?? '',
    enabled: provider.enabled,
  };
}

export type Advanced = { customHeaders?: Record<string, string>; extraConfig?: Record<string, unknown> };

/** Lit la config avancée : `customHeaders` à part, le reste en options. Vide, elle ne change rien. */
export function parseAdvanced(text: string, reasons: { object: string; headers: string }): Advanced | { error: string } {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: reasons.object };
  const { customHeaders, ...extraConfig } = parsed as Record<string, unknown>;
  if (customHeaders !== undefined) {
    const values = customHeaders && typeof customHeaders === 'object' && !Array.isArray(customHeaders) ? Object.values(customHeaders) : null;
    if (!values || values.some((value) => typeof value !== 'string')) return { error: reasons.headers };
  }
  return {
    customHeaders: customHeaders as Record<string, string> | undefined,
    extraConfig: Object.keys(extraConfig).length > 0 ? extraConfig : undefined,
  };
}

export const isAdvanced = (value: Advanced | { error: string }): value is Advanced => !('error' in value);

/** Une adresse https vers un hôte public, d'après son écriture. Le bot refait le contrôle en résolvant le nom. */
export const isHttpsUrl = isPublicHttpsUrl;

export function validateProvider(form: ProviderForm, t: TFunction): ProviderErrors {
  const errors: ProviderErrors = {};
  if (!form.displayName.trim()) errors.displayName = t('providers.sheet.nameRequired');
  if (form.slug && !SLUG.test(form.slug)) errors.slug = t('providers.sheet.slugInvalid');
  if (!isHttpsUrl(form.baseUrl.trim())) errors.baseUrl = t('providers.sheet.baseUrlInvalid');
  return errors;
}

export function buildCreate(form: ProviderForm, advanced: Advanced): ProviderCreate {
  const body: ProviderCreate = {
    displayName: form.displayName.trim(),
    protocol: form.protocol,
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
    enabled: form.enabled,
  };
  if (form.slug.trim()) body.slug = form.slug.trim();
  if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
  if (form.authType === 'header') body.authHeaderName = form.authHeaderName.trim() || null;
  if (advanced.customHeaders) body.customHeaders = advanced.customHeaders;
  if (advanced.extraConfig) body.extraConfig = advanced.extraConfig;
  return body;
}

/** Ce qui change, rien d'autre ; un objet vide s'il n'y a rien à envoyer. */
export function buildUpdate(provider: ProviderView, form: ProviderForm, advanced: Advanced): ProviderUpdate {
  const body: ProviderUpdate = {};
  if (form.displayName.trim() !== provider.displayName) body.displayName = form.displayName.trim();
  if (form.protocol !== provider.protocol) body.protocol = form.protocol;
  if (form.baseUrl.trim() !== provider.baseUrl) body.baseUrl = form.baseUrl.trim();
  if (form.authType !== provider.authType) body.authType = form.authType;
  if (form.authType === 'header' && form.authHeaderName.trim() !== (provider.authHeaderName ?? '')) {
    body.authHeaderName = form.authHeaderName.trim() || null;
  }
  if (form.enabled !== provider.enabled) body.enabled = form.enabled;
  // Une clé saisie l'emporte sur la case de retrait : ce qu'on vient de taper est l'intention la plus récente.
  if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
  else if (form.removeKey && provider.key.hasApiKey) body.apiKey = null;
  if (advanced.customHeaders) body.customHeaders = advanced.customHeaders;
  if (advanced.extraConfig) body.extraConfig = advanced.extraConfig;
  return body;
}
