import { mount } from 'svelte';
import './styles.css';
import './ui.css';
import './ui/product-controls.css';
import './ui/overlays.css';
import './voice-orb.css';
import { initUiLanguage } from './i18n';
import { applyAppearance, defaultAppearance } from './settings/appearance';
import OrbMusicDemo from './OrbMusicDemo.svelte';

document.documentElement.dataset.page = 'orb-demo';
initUiLanguage();
applyAppearance(defaultAppearance);
mount(OrbMusicDemo, { target: document.getElementById('app')! });
