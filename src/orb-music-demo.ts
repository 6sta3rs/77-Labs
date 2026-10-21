import { mount } from 'svelte';
import './styles.css';
import './lib/ui.css';
import './lib/ui/product-controls.css';
import './lib/ui/overlays.css';
import './lib/voice-orb.css';
import { initUiLanguage } from './lib/i18n';
import { applyAppearance, defaultAppearance } from './lib/settings/appearance';
import OrbMusicDemo from './OrbMusicDemo.svelte';

document.documentElement.dataset.page = 'orb-demo';
initUiLanguage();
applyAppearance(defaultAppearance);
mount(OrbMusicDemo, { target: document.getElementById('app')! });
