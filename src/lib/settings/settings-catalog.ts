import { Settings, Palette, BookOpen, Keyboard, Download, Cpu, Boxes, Network, Cable, Sparkles, HardDrive, Shield } from '@lucide/svelte';

// 12 pages in 4 groups (docs/features/ustawienia-styl.md). Every former control has exactly one home.
export const settingsGroups = [
  { title: 'Aplikacja', items: [
    { id: 'general', label: 'Ogólne', icon: Settings }, { id: 'appearance', label: 'Wygląd', icon: Palette },
    { id: 'dictionary', label: 'Słownik wymowy', icon: BookOpen }, { id: 'shortcuts', label: 'Skróty i mikrofon', icon: Keyboard },
    { id: 'updates', label: 'Aktualizacje', icon: Download } ] },
  { title: 'Silnik i modele', items: [{ id: 'engine', label: 'Silnik', icon: Cpu }, { id: 'models', label: 'Modele', icon: Boxes }] },
  { title: 'Połączenia', items: [{ id: 'network', label: 'Sieć i dostęp', icon: Network }, { id: 'integrations', label: 'Integracje', icon: Cable }, { id: 'ai', label: 'AI i klucze', icon: Sparkles }] },
  { title: 'Dane', items: [{ id: 'storage', label: 'Przechowywanie', icon: HardDrive }, { id: 'privacy', label: 'Prywatność i użycie', icon: Shield }] },
] as const;

export const settingsSections: (typeof settingsGroups)[number]['items'][number][] = settingsGroups.flatMap(group => [...group.items]);

export type SettingsSection = typeof settingsSections[number]['id'];

export function findSettings(query: string, translate: (label: string) => string = label => label) {
  const normalized = query.trim().toLocaleLowerCase();
  return settingsGroups.map(group => ({ title: group.title, items: group.items.filter(item => translate(item.label).toLocaleLowerCase().includes(normalized)) })).filter(group => group.items.length);
}
