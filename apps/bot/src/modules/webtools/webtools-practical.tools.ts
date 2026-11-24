import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { safeFetchJson } from '../../shared/utils/safe-fetch';

/**
 * Tools d'infos pratiques : météo, jours fériés, conversion de devise,
 * géolocalisation d'IP, palette de couleurs. Ordre d'origine dans le
 * registry : getWeather, getPublicHolidays, convertCurrency, lookupIp,
 * getColorSchema. Chaque appel passe par la garde des requêtes sortantes.
 */
export function buildPracticalTools(): BotTool[] {
  return [
    {
      name: 'getWeather',
      description: 'Météo actuelle + prévisions du jour pour une ville (Open-Meteo, mondial).',
      category: 'web',
      paramsSchema: z.object({ city: z.string().min(2).max(80) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Cherche la ville via le géocodage intégré : aucun ID à deviner. Convertis les codes météo en texte français.',
      handler: async (input, _ctx) => {
        const { city } = input as { city: string };
        const geo = await safeFetchJson<{ results?: Array<{ latitude: number; longitude: number; name: string; country: string }> }>(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`,
        );
        const place = geo?.results?.[0];
        if (!place) return { ok: false, summary: `Ville « ${city} » introuvable.` };
        const forecast = await safeFetchJson<{
          current?: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
          daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
        }>(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`,
        );
        const current = forecast?.current;
        if (!current) return { ok: false, summary: 'Prévisions indisponibles.' };
        const codes: Record<number, string> = { 0: 'ciel dégagé', 1: 'peu nuageux', 2: 'partiellement nuageux', 3: 'couvert', 45: 'brouillard', 51: 'bruine légère', 61: 'pluie légère', 63: 'pluie', 65: 'pluie forte', 71: 'neige légère', 73: 'neige', 75: 'neige forte', 80: 'averses', 95: 'orage' };
        const label = codes[current.weather_code] ?? `code ${current.weather_code}`;
        const day = forecast.daily;
        const summary = `Météo à ${place.name} (${place.country}) : ${label}, ${Math.round(current.temperature_2m)}°C (ressenti ${Math.round(current.apparent_temperature)}°C), vent ${Math.round(current.wind_speed_10m)} km/h.${day ? ` Jour : ${Math.round(day.temperature_2m_min[0])} à ${Math.round(day.temperature_2m_max[0])}°C, pluie ${day.precipitation_probability_max[0]}%.` : ''}`;
        return { ok: true, summary, data: { place: place.name, ...current } };
      },
    },
    {
      name: 'getPublicHolidays',
      description: 'Jours fériés officiels d\u0027un pays pour une année (Nager.Date, 100+ pays, code pays ISO FR/US/DE...).',
      category: 'web',
      paramsSchema: z.object({
        country: z.string().min(2).max(2).describe('Code ISO du pays (FR, US, DE...)'),
        year: z.number().int().min(2020).max(2100).default(2026),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Source : date.nager.at. Cite la source et le pays. Utile pour planifier des événements de serveur.',
      handler: async (input, _ctx) => {
        const { country, year } = input as { country: string; year?: number };
        // Un pays inconnu répond 404 avec un objet : la réponse est lue quel que soit le statut.
        const holidays = await safeFetchJson<Array<{ date: string; name: string; localName: string }>>(
          `https://date.nager.at/api/v3/publicholidays/${year ?? 2026}/${country.toUpperCase()}`,
        );
        if (!Array.isArray(holidays) || holidays.length === 0) return { ok: false, summary: 'Aucun jour férié trouvé pour ce pays/année.' };
        const lines = holidays.slice(0, 15).map((holiday) => `${holiday.date} : ${holiday.localName} (${holiday.name})`);
        return { ok: true, summary: `Jours fériés ${year ?? 2026} (${country.toUpperCase()}), source date.nager.at) : ${lines.join(' | ')}`, data: { count: holidays.length } };
      },
    },
    {
      name: 'convertCurrency',
      description: 'Convertit un montant entre devises (Frankfurter, taux BCE officiels, sans clé).',
      category: 'web',
      paramsSchema: z.object({
        amount: z.number().min(0),
        from: z.string().min(3).max(3),
        to: z.string().min(3).max(3),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Codes devises ISO (EUR, USD, GBP...). Source : Frankfurter (Banque centrale européenne). Cite la source.',
      handler: async (input, _ctx) => {
        const { amount, from, to } = input as { amount: number; from: string; to: string };
        const data = await safeFetchJson<{ rates?: Record<string, number> }>(
          `https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${from.toUpperCase()}&to=${to.toUpperCase()}`,
        );
        const rate = data?.rates?.[to.toUpperCase()];
        if (rate === undefined) return { ok: false, summary: 'Devises inconnues ou non supportées.' };
        return {
          ok: true,
          summary: `${amount} ${from.toUpperCase()} = ${rate} ${to.toUpperCase()} (source : Frankfurter/BCE).`,
          data: { rate },
        };
      },
    },
    {
      name: 'lookupIp',
      description: 'Géolocalisation approximative d\u0027une IP publique (ipwho.is, sans clé).',
      category: 'web',
      paramsSchema: z.object({ ip: z.string().min(7).max(45) }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Usage diagnostic uniquement (serveurs, connectivité). Ne géolocalise pas des membres.',
      handler: async (input, _ctx) => {
        const { ip } = input as { ip: string };
        // L'adresse part dans le chemin d'un hôte fixe : elle ne peut pas changer la cible.
        const data = await safeFetchJson<{ success?: boolean; message?: string; country?: string; city?: string; connection?: { isp?: string } }>(
          `https://ipwho.is/${encodeURIComponent(ip)}`,
        );
        if (!data?.success) return { ok: false, summary: `IP introuvable ou privée${data?.message ? ` (${data.message})` : ''}.` };
        return { ok: true, summary: `${ip} : ${data.city ?? '?'}, ${data.country ?? '?'} (FAI : ${data.connection?.isp ?? '?'}, source ipwho.is).` };
      },
    },
    {
      name: 'getColorSchema',
      description: 'Palette de couleurs depuis un hex (schéma, complémentaires, conversions).',
      category: 'web',
      paramsSchema: z.object({ hex: z.string().min(6).max(7).describe('Hex sans # ou avec') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Utile pour les demandes de schema de couleurs / branding de salon.',
      handler: async (input, _ctx) => {
        const { hex } = input as { hex: string };
        const clean = hex.replace('#', '');
        const data = await safeFetchJson<{
          hex?: { value?: string };
          scheme?: string;
          colors?: Array<{ hex?: { value?: string }; name?: { value?: string } }>;
        }>(`https://www.thecolorapi.com/scheme?hex=${clean}&format=json`);
        const palette = (data?.colors ?? []).map((color) => color.hex?.value).filter(Boolean);
        return {
          ok: true,
          summary: `Schéma ${data?.scheme ?? ''} depuis #${clean} : ${palette.join(', ')} (source : thecolorapi.com).`,
          data: { palette },
        };
      },
    },
  ];
}
