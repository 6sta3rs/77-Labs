import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './runtime';

export type RuntimeInstallStatus = { state: 'idle' | 'running' | 'cancelling' | 'interrupted' | 'cancelled' | 'failed' | 'ready' | 'activated'; phase: string; message: string; profile: string; candidate: string | null; downloadedBytes: number; totalBytes: number | null; logs: string[];
  environmentPresent?: boolean; cudaDriver?: boolean };
export const installingRuntime = (status?: RuntimeInstallStatus) => !!status && ['running', 'cancelling'].includes(status.state);
export const runtimeInstaller = {
  available: isDesktop,
  status: () => invoke<RuntimeInstallStatus>('installer_status'),
  start: (profile: 'cpu' | 'cuda') => invoke<RuntimeInstallStatus>('installer_start', { profile }),
  cancel: () => invoke<RuntimeInstallStatus>('installer_cancel'),
  activate: () => invoke<RuntimeInstallStatus>('installer_activate'),
  cleanup: () => invoke<number>('installer_cleanup'),
};
