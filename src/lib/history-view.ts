import type { Render } from './data';
export type HistoryFilters = {
  query: string;
  voice: string;
  model: string;
  date: string;
  source: string;
};

type RecordingGroup = { key: string; label: string; rows: Render[] };
const millisecondsPerDay = 86400000;

let relativeTimeFormatter: Intl.RelativeTimeFormat | undefined;
let dateFormatter: Intl.DateTimeFormat | undefined;

export function filterRecordings(rows: Render[], filter: HistoryFilters, now = Date.now()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const cutoffs: Record<string, number> = {
    today: startOfToday.getTime(),
    week: now - 7 * millisecondsPerDay,
    month: now - 30 * millisecondsPerDay,
  };
  const query = filter.query.toLocaleLowerCase('pl').trim();
  const cutoff = cutoffs[filter.date] ?? -Infinity;

  return rows.filter(row => {
    if (query) {
      const searchText = [row.text, row.title, row.voice, row.modelName || '']
        .join(' ')
        .toLocaleLowerCase('pl');
      if (!searchText.includes(query)) return false;
    }
    if (filter.voice && row.voice !== filter.voice) return false;
    if (filter.model) {
      const matchesModel = filter.model === 'unknown' ? !row.modelId : row.modelId === filter.model;
      if (!matchesModel) return false;
    }
    if (filter.source && (row.source || 'unknown') !== filter.source) return false;

    // An active date filter also excludes invalid dates, even for an unknown range.
    return !filter.date || new Date(row.created).getTime() >= cutoff;
  });
}

export function historyDateLabel(created: string, now = Date.now()) {
  const value = new Date(created);
  if (!Number.isFinite(value.getTime())) return 'Bez daty';
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (value.toDateString() === today.toDateString()) return 'Dzisiaj';
  if (value.toDateString() === yesterday.toDateString()) return 'Wczoraj';
  const formatter = dateFormatter ??= new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return formatter.format(value);
}

export function relativeRecordingTime(created: string, now = Date.now()) {
  const time = new Date(created).getTime();
  if (!Number.isFinite(time)) return 'Brak daty';
  const minutes = Math.round((time - now) / 60000);
  const formatter = relativeTimeFormatter ??= new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });
  if (Math.abs(minutes) < 1) return 'przed chwilą';
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return formatter.format(Math.round(minutes / 60), 'hour');
  return formatter.format(Math.round(minutes / 1440), 'day');
}

export function groupRecordings(rows: Render[], now = Date.now(), oldestFirst = false) {
  const sorted = [...rows].sort((a, b) => {
    const left = new Date(a.created).getTime();
    const right = new Date(b.created).getTime();
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if (!Number.isFinite(right)) return -1;
    return oldestFirst ? left - right : right - left;
  });
  const groups: RecordingGroup[] = [];
  const byDate = new Map<string, RecordingGroup>();
  for (const row of sorted) {
    const date = new Date(row.created);
    const key = Number.isFinite(date.getTime())
      ? [date.getFullYear(), date.getMonth(), date.getDate()].join('-')
      : 'unknown';
    let group = byDate.get(key);
    if (!group) {
      group = { key, label: historyDateLabel(row.created, now), rows: [] };
      byDate.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}
