<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { SettingsSection } from '../shell/navigation';
  import { findSettings, settingsSections } from './settings-catalog';
  import Input from '../ui/Input.svelte';
  import SidebarHeader from '../shell/SidebarHeader.svelte';
  import SidebarFooter from '../shell/SidebarFooter.svelte';
  import ShellTopbar from '../shell/ShellTopbar.svelte';
  let { section, onsection, onback, backLabel, children, onhome, onsearch, onprojects, onrefresh, refreshing, runtimeState, collapsed, ontoggle }: { section: SettingsSection; onsection: (section: SettingsSection) => void; onback: () => void; backLabel: string; children: Snippet; onhome: () => void; onsearch: () => void; onprojects: () => void; onrefresh: () => void; refreshing: boolean; runtimeState: string; collapsed: boolean; ontoggle: () => void } = $props();
  onMount(() => document.querySelector<HTMLElement>('.settings-shell .shell-topbar strong')?.focus());
  let query = $state('');
  const sections = $derived(findSettings(query));

  function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.modal-backdrop,dialog[open],[role=listbox]')) { event.preventDefault(); onback(); } }
</script>

<svelte:window onkeydown={keydown}/>
<div class="settings-shell" class:sidebar-hidden={collapsed}><aside class="settings-navigation sidebar-surface" aria-label="Nawigacja ustawień"><SidebarHeader {onhome} {onsearch}/><div class="settings-filter"><Input type="search" aria-label="Filtruj ustawienia" placeholder="Filtruj ustawienia…" bind:value={query}/></div><div class="settings-nav-body"><nav aria-label="Sekcje ustawień">{#each sections as item (item.id)}<button class="shell-nav-row" class:current={section === item.id} aria-current={section === item.id ? 'page' : undefined} title={item.label} onclick={() => onsection(item.id)}><span class="shell-nav-destination"><item.icon size={17}/><span>{item.label}</span></span></button>{/each}{#if !sections.length}<p class="settings-no-results">Brak pasujących ustawień.</p>{/if}</nav></div><SidebarFooter {runtimeState} settings onsettings={() => {}} onmodels={() => onsection('models')} {onprojects} {onrefresh} {refreshing} {onback} {backLabel}/></aside><main class="settings-main"><ShellTopbar title={`Ustawienia / ${settingsSections.find(item => item.id === section)?.label}`} {ontoggle} {collapsed}/><div class="settings-scroll"><div class="settings-content">{@render children()}</div></div></main></div>
<style>
  .settings-shell{position:fixed;inset:0;z-index:80;display:grid;background:var(--background);color:var(--foreground)}.settings-nav-body{flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable}.settings-filter{padding:0 0 12px}.settings-no-results{padding:12px;font-size:var(--ui-text-12);color:var(--muted)}.settings-navigation .shell-nav-destination>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.settings-navigation nav{display:flex;flex-direction:column;gap:0}.settings-navigation nav>button{height:var(--nav-row-height);min-height:var(--nav-row-height);padding:0;text-align:left}.settings-main{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}.settings-scroll{scrollbar-gutter:stable;overflow-y:auto;flex:1;min-height:0}.settings-content{max-width:820px;margin:auto;padding:30px 34px 48px}.settings-content :global(.page-body.narrow),.settings-content :global(.settings-page),.settings-content :global(.ai-settings),.settings-content :global(.shortcuts-page),.settings-content :global(.appearance-panel){max-width:none;margin:0;padding:0}.settings-content :global(.page-heading){margin-bottom:32px}.settings-content :global(h1){font-size:var(--ui-text-22);font-weight:600;letter-spacing:-.5px}.settings-content :global(.ai-settings>header){align-items:flex-start;margin-bottom:32px}.settings-content :global(.ai-settings>header>svg){display:none}.settings-content :global(.ai-settings>header p),.settings-content :global(.page-heading p){font-size:var(--ui-text-13);line-height:1.5;margin-top:7px}@media(max-width:650px){.settings-content{padding:22px 18px 32px}}
</style>
