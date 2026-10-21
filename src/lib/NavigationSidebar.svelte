<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { dismissiblePopup } from './ui/overlay';
  import { Plus, Pin, PinOff, Ellipsis, ChevronRight, Search, Folder } from '@lucide/svelte';
  import SidebarHeader from './SidebarHeader.svelte';
  import SidebarFooter from './SidebarFooter.svelte';
  import Button from './ui/Button.svelte';
  import { House, LayoutGrid } from '@lucide/svelte';
  import { defaultPins, parsePins, pinStorageKey, type NavigationItem } from './navigation';
  import type { Page, Project } from './data';
  let { items, active, projects, projectId, runtimeState, onnavigate, onnew, onproject, onsettings, onnotify, onsearch, onback, backLabel, backDisabled, onrefresh, refreshing, onaddvoice }: {
    items: NavigationItem[]; active: Page; projects: Project[]; projectId: string; runtimeState: string;
    onaddvoice: () => void; onsearch: () => void; onback: () => void; backLabel: string; backDisabled: boolean; onrefresh: () => void; refreshing: boolean;
    onnavigate: (page: Page) => void; onnew: () => void; onproject: (project: Project) => void; onsettings: (section?: 'models') => void; onnotify: (message: string) => void;
  } = $props();
  let pins = $state<Page[]>([...defaultPins]), open = $state(false), search = $state('');
  let menuTrigger = $state<HTMLButtonElement>();
  let position = $state({ left: 224, top: 200 });
  const toolItems = $derived(items.filter(item => item.id !== 'voices'));
  const pinnedItems = $derived(pins.map(id => toolItems.find(item => item.id === id)).filter((item): item is NavigationItem => Boolean(item)));
  const visiblePins = $derived(pinnedItems);
  const remainingItems = $derived(toolItems.filter(item => !pins.includes(item.id)));
  const filteredItems = $derived(remainingItems.filter(item => item.label.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'))));
  onMount(() => { try { pins = parsePins(localStorage.getItem(pinStorageKey), items.map(item => item.id)); } catch { onnotify('Nie można odczytać przypiętych narzędzi.'); } });
  function togglePin(id: Page) { pins = pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id]; try { localStorage.setItem(pinStorageKey, JSON.stringify(pins)); } catch { onnotify('Nie udało się zapisać przypiętych narzędzi.'); } void tick().then(() => { if(open){positionMenu();document.querySelector<HTMLInputElement>('.tools-popover input')?.focus();}else (menuTrigger || document.querySelector<HTMLButtonElement>('.nav-destination'))?.focus(); }); }
  function positionMenu() {
    const menu = document.querySelector<HTMLElement>('.tools-popover'); if (!menu) return;
    if (!menuTrigger) return;
    const rect = menuTrigger.getBoundingClientRect(), box = menu.getBoundingClientRect();
    position = { left: Math.max(12, Math.min(rect.right + 8, innerWidth - box.width - 12)), top: Math.max(12, Math.min(rect.top, innerHeight - box.height - 12)) };
  }
  async function toggleMore() { open = !open; search = ''; if (open) { await tick(); positionMenu(); document.querySelector<HTMLInputElement>('.tools-popover input')?.focus(); } }
  $effect(() => { const term = search; const count = remainingItems.length; if (open && !count) { open = false; void tick().then(() => document.querySelector<HTMLButtonElement>('.nav-destination')?.focus()); } else if (open) void tick().then(positionMenu); });
  function addVoice(){open=false;onaddvoice();}
  function navigate(page: Page) { open = false; onnavigate(page); }
</script>

<aside class="sidebar navigation-sidebar sidebar-surface" aria-label="Nawigacja studia">
  <SidebarHeader onhome={() => navigate('dashboard')} {onsearch}/>
  <div class="sidebar-context">
    <div class="nav-entry shell-nav-row" class:current={active === 'dashboard'}><button class="nav-destination shell-nav-destination" aria-current={active === 'dashboard' ? 'page' : undefined} onclick={() => navigate('dashboard')}><House size={17}/><span>Pulpit</span></button><Button variant="ghost" size="icon" class="row-action" aria-label="Nowa narracja" title="Nowa narracja" onclick={onnew}><Plus size={16}/></Button></div>
    <div class="nav-entry shell-nav-row voice-entry" class:current={active === 'voices'}><button class="nav-destination shell-nav-destination" aria-current={active === 'voices' ? 'page' : undefined} onclick={() => navigate('voices')}><LayoutGrid size={17}/><span>Głosy</span></button><Button variant="ghost" size="icon" class="row-action" aria-label="Dodaj głos" title="Dodaj głos" onclick={addVoice}><Plus size={16}/></Button></div>
  </div>
  <div class="pinned-area"><div class="sidebar-section-title">Przypięte</div><nav class="pinned-scroll" aria-label="Przypięte narzędzia">{#each visiblePins as item}<div class="nav-entry shell-nav-row" class:current={active === item.id}><button class="nav-destination shell-nav-destination" aria-current={active === item.id ? 'page' : undefined} onclick={() => navigate(item.id)}><item.icon size={17}/><span>{item.label}</span></button><button class="pin-action shell-pin" aria-label={`Odepnij ${item.label}`} title={`Odepnij ${item.label}`} onclick={() => togglePin(item.id)}><PinOff size={14}/></button></div>{/each}</nav>
  {#if remainingItems.length}<button class="more-tools shell-nav-row" bind:this={menuTrigger} aria-expanded={open} onclick={toggleMore}><Ellipsis size={17}/><span>Więcej narzędzi</span><ChevronRight size={15}/></button>{/if}{#if !pins.length}<p class="pin-empty">Przypnij funkcje z menu narzędzi.</p>{/if}</div>
  <div class="recent-projects"><div class="sidebar-section-title">Ostatnie projekty</div>{#each projects.slice(0,2) as project}<button class:current={project.id === projectId} onclick={() => onproject(project)}><Folder size={14}/><span>{project.name}</span></button>{/each}</div>
  <SidebarFooter {runtimeState} onsettings={() => onsettings()} onmodels={() => onsettings('models')} onprojects={() => navigate('projects')} {onrefresh} {refreshing} {onback} {backLabel} {backDisabled}/>
</aside>
{#if open}<div class="tools-popover" use:dismissiblePopup={{ trigger: () => menuTrigger, close: () => { open = false } }} role="dialog" tabindex="-1" aria-label="Więcej narzędzi" style={`left:${position.left}px;top:${position.top}px`}><label class="tools-search"><Search size={14}/><input aria-label="Szukaj narzędzia" placeholder="Szukaj narzędzia" bind:value={search}/></label><div class="all-tools">{#each filteredItems as item}<div class="nav-entry shell-nav-row" class:current={active === item.id}><button class="nav-destination shell-nav-destination" onclick={() => navigate(item.id)}><item.icon size={17}/><span>{item.label}</span></button><button class="pin-action shell-pin" aria-label={`Przypnij ${item.label}`} aria-pressed="false" title="Przypnij do nawigacji" onclick={() => togglePin(item.id)}><Pin size={14}/></button></div>{/each}</div>{#if !filteredItems.length}<p class="pin-empty">{search ? 'Brak pasujących narzędzi.' : 'Wszystkie narzędzia są przypięte.'}</p>{/if}</div>{/if}
<style>
  .navigation-sidebar .sidebar-context{height:auto;display:flex;flex-direction:column;gap:2px}
  @media(pointer:coarse){.navigation-sidebar .sidebar-context{gap:8px}}
  .tools-popover .shell-pin{width:28px;margin-right:4px;opacity:1}
  .navigation-sidebar.sidebar{overflow:hidden;min-height:0}.pinned-area{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}.pinned-scroll{min-height:0;overflow-y:auto;overflow-x:hidden;padding:3px 0}.pinned-area>.sidebar-section-title,.more-tools{flex-shrink:0}.pinned-area nav{display:flex;flex-direction:column;gap:0}.more-tools{width:100%;gap:10px;padding:0 10px;margin:4px 0 12px;text-align:left;font-size:var(--nav-font-size);font-weight:550;background:transparent;}.more-tools span{flex:1;white-space:nowrap}.more-tools :global(svg){flex-shrink:0}.more-tools[aria-expanded=true]{background:var(--sidebar-hover,var(--surface-hover))}.recent-projects{flex-shrink:0;padding:4px 0 10px}.recent-projects>button{display:flex;align-items:center;gap:9px;width:100%;height:30px;padding:0 10px;border-radius:var(--nav-radius);text-align:left;color:var(--muted);font-size:var(--ui-text-11)}.recent-projects>button:hover{background:var(--sidebar-hover)}.recent-projects span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tools-popover{position:fixed;z-index:110;width:var(--menu-width);max-height:calc(100dvh - 24px);overflow-y:auto;padding:6px;color:var(--foreground);border:1px solid var(--border);border-radius:var(--menu-radius);box-shadow:var(--popup-shadow)}.tools-search{display:flex;gap:7px;align-items:center;height:30px;margin:2px 4px 6px;color:var(--muted)}.tools-search:focus-within{outline:2px solid var(--focus,var(--accent));outline-offset:1px;border-radius:6px}.tools-search input{width:100%;min-width:0;border:0;background:transparent;outline:none;font-size:var(--ui-text-12)}.all-tools{display:flex;flex-direction:column;gap:0}.tools-popover .shell-nav-row{color:var(--muted)}.tools-popover .shell-nav-row:hover{color:var(--foreground)}.pin-empty{font-size:var(--ui-text-11);line-height:1.6;padding:10px;color:var(--muted)}@media(max-height:700px){.recent-projects>button:nth-of-type(n+2){display:none}.recent-projects{padding-bottom:6px}}
</style>
