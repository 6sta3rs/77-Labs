<script lang="ts">
  import { ArrowLeft, Settings, FolderOpen, RefreshCw } from '@lucide/svelte';
  import Button from '../ui/Button.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import DeviceStatus from '../platform/DeviceStatus.svelte';
  let { runtimeState, settings = false, onsettings, onprojects, onrefresh, refreshing = false, onback, backLabel, backDisabled = false, onmodels }: {
    onmodels?: () => void; runtimeState: string; settings?: boolean; onsettings: () => void; onprojects: () => void; onrefresh: () => void;
    refreshing?: boolean; onback: () => void; backLabel: string; backDisabled?: boolean;
  } = $props();
</script>
<footer class="sidebar-footer">{#if settings}<button class="shell-back settings-back" disabled={backDisabled} title={`Wróć do: ${backLabel}`} onclick={onback}><ArrowLeft size={16}/><span>Wróć</span><small>{backLabel}</small></button>{:else}<div class="sidebar-actions"><Tooltip content="Ustawienia"><Button variant="ghost" size="icon" class="settings-trigger footer-action" aria-label="Ustawienia" aria-pressed={settings} onclick={onsettings}><Settings size={16}/></Button></Tooltip><Tooltip content="Projekty"><Button variant="ghost" size="icon" class="footer-action" aria-label="Projekty" onclick={onprojects}><FolderOpen size={16}/></Button></Tooltip><DeviceStatus state={runtimeState} onmodels={onmodels||onsettings}/><span class="footer-spacer"></span><Tooltip content="Odśwież stan studia"><Button variant="ghost" size="icon" class="footer-action" aria-label="Odśwież stan studia" disabled={refreshing} onclick={onrefresh}><RefreshCw size={16} class={refreshing ? 'spin' : ''}/></Button></Tooltip></div>{/if}</footer>
