<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import { ArrowLeft, Settings, FolderOpen, RefreshCw } from '@lucide/svelte';
  import Button from '../ui/Button.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import DeviceStatus from '../platform/DeviceStatus.svelte';
  let { runtimeState, settings = false, onsettings, onprojects, onrefresh, refreshing = false, onback, backLabel, backDisabled = false, onmodels }: {
    onmodels?: () => void; runtimeState: string; settings?: boolean; onsettings: () => void; onprojects: () => void; onrefresh: () => void;
    refreshing?: boolean; onback: () => void; backLabel: string; backDisabled?: boolean;
  } = $props();
</script>
<footer class="sidebar-footer">{#if settings}<button class="shell-back settings-back" disabled={backDisabled} title={tr("Wróć do: {value0}", {value0: (backLabel)})} onclick={onback}><ArrowLeft size={16}/><span>{tr("Wróć")}</span><small>{tr(backLabel)}</small></button>{:else}<div class="sidebar-actions"><Tooltip content={tr("Ustawienia")}><Button variant="ghost" size="icon" class="settings-trigger footer-action" aria-label={tr("Ustawienia")} aria-pressed={settings} onclick={onsettings}><Settings size={16}/></Button></Tooltip><Tooltip content={tr("Projekty")}><Button variant="ghost" size="icon" class="footer-action" aria-label={tr("Projekty")} onclick={onprojects}><FolderOpen size={16}/></Button></Tooltip><DeviceStatus state={runtimeState} onmodels={onmodels||onsettings}/><span class="footer-spacer"></span><Tooltip content={tr("Sprawdź aktualizacje")}><Button variant="ghost" size="icon" class="footer-action" aria-label={tr("Sprawdź aktualizacje")} disabled={refreshing} onclick={onrefresh}><RefreshCw size={16} class={refreshing ? 'spin' : ''}/></Button></Tooltip></div>{/if}</footer>
