import { Settings, Palette, Cpu, BookOpen, Download, Network, Share2, KeyRound, Gauge, ChartNoAxesCombined, Server, Shield, LockKeyhole, HardDrive, Stethoscope, Cable, Sparkles, Keyboard, AudioLines, ScrollText } from '@lucide/svelte';

export const settingsSections = [
  { id: 'general', label: 'Ogólne', icon: Settings },
  { id: 'appearance', label: 'Wygląd', icon: Palette },
  { id: 'models', label: 'Modele i silnik', icon: Cpu },
  { id: 'dictionary', label: 'Słownik wymowy', icon: BookOpen },
  { id: 'updates', label: 'Aktualizacje', icon: Download },
  { id: 'network', label: 'Sieć', icon: Network },
  { id: 'sharing', label: 'Dostęp zdalny', icon: Share2 },
  { id: 'credentials', label: 'Klucze i poświadczenia', icon: KeyRound },
  { id: 'compute', label: 'Urządzenie obliczeniowe', icon: Gauge },
  { id: 'usage', label: 'Wykorzystanie', icon: ChartNoAxesCombined },
  { id: 'remote-workers', label: 'Zdalne procesy robocze', icon: Server },
  { id: 'privacy', label: 'Prywatność', icon: Shield },
  { id: 'permissions', label: 'Uprawnienia', icon: LockKeyhole },
  { id: 'storage', label: 'Przechowywanie', icon: HardDrive },
  { id: 'preflight', label: 'Kontrola systemu', icon: Stethoscope },
  { id: 'integrations', label: 'API i integracje', icon: Cable },
  { id: 'audio-tools', label: 'Narzędzia audio', icon: AudioLines },
  { id: 'logs', label: 'Dzienniki', icon: ScrollText },
  { id: 'ai-settings', label: 'AI i subskrypcja', icon: Sparkles },
  { id: 'shortcuts', label: 'Skróty klawiaturowe', icon: Keyboard },
] as const;

export type SettingsSection = typeof settingsSections[number]['id'];

export function findSettings(query: string) {
  const normalized = query.trim().toLocaleLowerCase('pl');
  return settingsSections.filter(item => item.label.toLocaleLowerCase('pl').includes(normalized));
}
