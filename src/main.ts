import { mount } from 'svelte';
import './styles.css';
import './lib/styles/ui.css';
import './lib/ui/product-controls.css';
import './lib/ui/overlays.css';
import './lib/ui/focus-intent.css';
import { installFocusIntent } from './lib/styles/focus-intent';
const disposeFocusIntent = installFocusIntent(document);
import.meta.hot?.dispose(disposeFocusIntent);
const controls = /\/inputy(?:\.html)?\/?$/.test(location.pathname) || document.documentElement.dataset.page === 'controls';
if (controls) document.documentElement.dataset.page = 'controls';
if (controls) {
  void import('./lib/gallery/ControlGallery.svelte').then(({ default: ControlGallery }) => {
    mount(ControlGallery, { target: document.getElementById('app')! });
  }).catch(() => {
    document.getElementById('app')!.textContent = 'Nie udało się wczytać biblioteki kontrolek. Odśwież okno.';
  });
} else if (new URLSearchParams(location.search).get('dictationWidget') === '1') {
  document.documentElement.dataset.page = 'dictation-widget';
  void import('./lib/tools/dictation/DictationWidget.svelte').then(({ default: Widget }) => mount(Widget, { target: document.getElementById('app')! })).catch(() => {
    document.getElementById('app')!.textContent = 'Nie udało się wczytać okna dyktowania.';
  });
} else {
  void import('./App.svelte').then(({ default: App }) => mount(App, { target: document.getElementById('app')! })).catch(() => {
    document.getElementById('app')!.textContent = 'Nie udało się wczytać studia. Uruchom aplikację ponownie.';
  });
}
