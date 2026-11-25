import {
  WEBHOOK_METHODS,
  type WebhookAuthType,
  type WebhookCreate,
  type WebhookEndpointView,
  type WebhookMethod,
  type WebhookUpdate,
} from '@10cordes/shared';
import { isPublicHttpsUrl } from '@/lib/url';

/*
 * FORMULAIRE D'UN CONNECTEUR, sans rendu. Le jeton d'authentification est un
 * en-tête secret parmi les autres : il rejoint `secretHeaders` sous le nom
 * de l'en-tête d'authentification (Authorization pour un bearer). En
 * édition, un champ secret vide n'est pas envoyé : le bot conserve celui
 * d'avant. Un champ JSON se lit en trois issues : vide, lu, illisible.
 */

export interface WebhookForm {
  name: string;
  slug: string;
  method: WebhookMethod;
  url: string;
  authType: WebhookAuthType;
  authHeaderName: string;
  token: string;
  publicHeaders: string;
  secretHeaders: string;
  requestTemplate: string;
  responseExtractPath: string;
  enabled: boolean;
}

export type FormErrors = Partial<Record<keyof WebhookForm, string>>;

export type Parsed<T> = { ok: true; value: T | null } | { ok: false };

export const EMPTY_FORM: WebhookForm = {
  name: '',
  slug: '',
  method: 'POST',
  url: '',
  authType: 'bearer',
  authHeaderName: 'X-Api-Key',
  token: '',
  publicHeaders: '',
  secretHeaders: '',
  requestTemplate: '',
  responseExtractPath: '',
  enabled: true,
};

const SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const AUTH_HEADER = /^[A-Za-z0-9-]{1,60}$/u;
const EXTRACT_PATH = /^[A-Za-z0-9_.-]*$/u;

export function formOf(view: WebhookEndpointView): WebhookForm {
  return {
    ...EMPTY_FORM,
    name: view.name,
    slug: view.slug,
    method: view.method,
    url: view.url,
    authType: view.authType,
    authHeaderName: view.authHeaderName ?? 'X-Api-Key',
    publicHeaders: Object.keys(view.publicHeaders).length > 0 ? JSON.stringify(view.publicHeaders, null, 2) : '',
    requestTemplate: view.requestTemplate === null ? '' : JSON.stringify(view.requestTemplate, null, 2),
    responseExtractPath: view.responseExtractPath ?? '',
    enabled: view.enabled,
  };
}

function parseJson(text: string): Parsed<unknown> {
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Un objet JSON quelconque ; vide, il vaut null. */
export function parseJsonObject(text: string): Parsed<unknown> {
  return parseJson(text);
}

/** Un objet JSON dont toutes les valeurs sont des chaînes ; vide, il vaut null. */
export function parseStringRecord(text: string): Parsed<Record<string, string>> {
  const json = parseJson(text);
  if (!json.ok) return { ok: false };
  if (json.value === null) return { ok: true, value: null };
  const value = json.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const record = value as Record<string, unknown>;
  if (Object.values(record).some((item) => typeof item !== 'string')) return { ok: false };
  return { ok: true, value: record as Record<string, string> };
}

export const isHttpsUrl = isPublicHttpsUrl;

/** Les en-têtes secrets saisis : ceux du champ JSON, plus le jeton sous son en-tête. */
export function secretHeadersOf(form: WebhookForm): Parsed<Record<string, string>> {
  const parsed = parseStringRecord(form.secretHeaders);
  if (!parsed.ok) return parsed;
  const headers: Record<string, string> = { ...(parsed.value ?? {}) };
  const token = form.token.trim();
  if (token) {
    const name = form.authType === 'bearer' ? 'Authorization' : form.authHeaderName.trim();
    if (name) headers[name] = form.authType === 'bearer' ? `Bearer ${token}` : token;
  }
  return { ok: true, value: Object.keys(headers).length > 0 ? headers : null };
}

export function buildWebhookCreate(form: WebhookForm): WebhookCreate {
  const body: WebhookCreate = {
    slug: form.slug.trim(),
    name: form.name.trim(),
    method: form.method,
    url: form.url.trim(),
    authType: form.authType,
    enabled: form.enabled,
  };
  if (form.authType === 'header') body.authHeaderName = form.authHeaderName.trim();
  const publicHeaders = parseStringRecord(form.publicHeaders);
  if (publicHeaders.ok && publicHeaders.value) body.publicHeaders = publicHeaders.value;
  const secretHeaders = secretHeadersOf(form);
  if (secretHeaders.ok && secretHeaders.value) body.secretHeaders = secretHeaders.value;
  const requestTemplate = parseJsonObject(form.requestTemplate);
  if (requestTemplate.ok && requestTemplate.value !== null) body.requestTemplate = requestTemplate.value;
  if (form.responseExtractPath.trim()) body.responseExtractPath = form.responseExtractPath.trim();
  return body;
}

/** Ce qui change, rien d'autre ; un objet vide s'il n'y a rien à envoyer. */
export function buildWebhookUpdate(view: WebhookEndpointView, form: WebhookForm): WebhookUpdate {
  const body: WebhookUpdate = {};
  if (form.name.trim() !== view.name) body.name = form.name.trim();
  if (form.url.trim() !== view.url) body.url = form.url.trim();
  if (form.authType !== view.authType) body.authType = form.authType;
  if (form.authType === 'header' && form.authHeaderName.trim() !== (view.authHeaderName ?? '')) body.authHeaderName = form.authHeaderName.trim();
  if (form.enabled !== view.enabled) body.enabled = form.enabled;
  const publicHeaders = parseStringRecord(form.publicHeaders);
  if (publicHeaders.ok && JSON.stringify(publicHeaders.value ?? {}) !== JSON.stringify(view.publicHeaders)) body.publicHeaders = publicHeaders.value ?? {};
  const secretHeaders = secretHeadersOf(form);
  if (secretHeaders.ok && secretHeaders.value) body.secretHeaders = secretHeaders.value;
  const requestTemplate = parseJsonObject(form.requestTemplate);
  if (requestTemplate.ok && JSON.stringify(requestTemplate.value) !== JSON.stringify(view.requestTemplate)) {
    body.requestTemplate = requestTemplate.value;
  }
  const path = form.responseExtractPath.trim() || null;
  if (path !== view.responseExtractPath) body.responseExtractPath = path;
  return body;
}

export function validateWebhook(
  form: WebhookForm,
  editing: boolean,
  messages: { name: string; slug: string; url: string; header: string; json: string; path: string },
): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = messages.name;
  if (!editing && !SLUG.test(form.slug.trim())) errors.slug = messages.slug;
  if (!isHttpsUrl(form.url.trim())) errors.url = messages.url;
  if (form.authType === 'header' && !AUTH_HEADER.test(form.authHeaderName.trim())) errors.authHeaderName = messages.header;
  if (!parseStringRecord(form.publicHeaders).ok) errors.publicHeaders = messages.json;
  if (!parseStringRecord(form.secretHeaders).ok) errors.secretHeaders = messages.json;
  if (!parseJsonObject(form.requestTemplate).ok) errors.requestTemplate = messages.json;
  if (form.responseExtractPath.trim() && !EXTRACT_PATH.test(form.responseExtractPath.trim())) errors.responseExtractPath = messages.path;
  if (!editing && !(WEBHOOK_METHODS as readonly string[]).includes(form.method)) errors.method = messages.header;
  return errors;
}
