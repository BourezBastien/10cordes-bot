import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * MISES EN FORME. Tout passe par Intl, dans la langue de l'interface. Une
 * date illisible donne une chaîne vide : « Invalid Date » n'affiche jamais.
 */

export type LocaleTag = 'fr-FR' | 'en-US';

type Instant = string | number | Date;

function localeTagOf(language: string): LocaleTag {
  return language.toLowerCase().startsWith('en') ? 'en-US' : 'fr-FR';
}

function toDate(value: Instant): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `m:ss`, ou `h:mm:ss` au-delà d'une heure. Une durée nulle ou négative donne `0:00`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

function toInstant(value: Instant): number {
  const time = toDate(value)?.getTime();
  return time === undefined ? Number.NaN : time;
}

/** « il y a 5 min » : la plus grande unité entière sous un jour, sinon la date courte. */
export function formatAgo(value: Instant, tag: LocaleTag, now = Date.now()): string {
  const time = toInstant(value);
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  const table: ReadonlyArray<[unit: Intl.RelativeTimeFormatUnit, size: number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
  ];
  if (abs < 60) return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(seconds, 'second');
  if (abs < 86_400 * 30) {
    for (const [unit, size] of [...table].reverse()) {
      if (abs >= size) return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
    }
  }
  return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(time);
}

export interface Format {
  number: (value: number) => string;
  /** 12 300 devient « 12,3 k ». */
  compact: (value: number) => string;
  percent: (value: number) => string;
  date: (value: Instant) => string;
  time: (value: Instant) => string;
  dateTime: (value: Instant) => string;
  ago: (value: Instant, now?: number) => string;
  duration: (ms: number) => string;
}

export function formattersOf(tag: LocaleTag): Format {
  const number = new Intl.NumberFormat(tag);
  const compact = new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
  const time = new Intl.DateTimeFormat(tag, { timeStyle: 'medium' });
  const both = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' });
  const show = (value: Instant, format: Intl.DateTimeFormat) => {
    const day = toDate(value);
    return day ? format.format(day) : '';
  };
  return {
    number: (value) => number.format(value),
    compact: (value) => compact.format(value),
    percent: (value) => percent.format(value),
    date: (value) => show(value, date),
    time: (value) => show(value, time),
    dateTime: (value) => show(value, both),
    ago: (value, now) => formatAgo(value, tag, now),
    duration: formatDuration,
  };
}

/** Les mises en forme, dans la langue courante de l'interface. */
export function useFormat(): Format {
  const { i18n } = useTranslation();
  const tag = localeTagOf(i18n.language);
  return useMemo(() => formattersOf(tag), [tag]);
}
