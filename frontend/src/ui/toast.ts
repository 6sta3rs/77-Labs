// Shared toast store for click results (settings pages). Pass already translated text: toast.ok(tr("Zapisano")). Usage: toast.ok('Zapisano'), toast.bad('Błąd …'), toast.warn(…), toast.info(…).
// At most 3 visible (newest last). ok/info vanish after 4 s, warn after 6 s, bad stays until dismissed. Rendered by Toaster.svelte, mounted once in App.svelte.
import { writable } from 'svelte/store';
export type ToastKind = 'ok' | 'bad' | 'warn' | 'info';
export type ToastItem = { id: number; kind: ToastKind; text: string };
export const toasts = writable<ToastItem[]>([]);
let next = 1;
export const dismiss = (id: number) => toasts.update(l => l.filter(t => t.id !== id));
const push = (kind: ToastKind) => (text: string) => toasts.update(l => [...l, { id: next++, kind, text }].slice(-3));
export const toast = { ok: push('ok'), bad: push('bad'), warn: push('warn'), info: push('info') };
