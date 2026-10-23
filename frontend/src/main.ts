import { mount } from 'svelte';
import { initUiLanguage, uiLanguage, translateUi } from './i18n';
import './styles.css';
import './styles/ui.css';
import './ui/product-controls.css';
import './ui/overlays.css';
import './ui/focus-intent.css';
import './settings/settings-page.css';
import { installFocusIntent } from './styles/focus-intent';
const disposeFocusIntent = installFocusIntent(document);

const controls = /\/inputy(?:\.html)?\/?$/.test(location.pathname) || document.documentElement.dataset.page === 'controls';
if (controls) document.documentElement.dataset.page = 'controls';
else if (new URLSearchParams(location.search).get('dictationWidget') === '1') document.documentElement.dataset.page = 'dictation-widget';
initUiLanguage();
let bootstrapError = '';
const disposeLanguage = uiLanguage.subscribe(() => {
  if (bootstrapError) document.getElementById('app')!.textContent = translateUi(bootstrapError);
});
const showBootstrapError = (source: string) => {
  bootstrapError = source;
  document.getElementById('app')!.textContent = translateUi(source);
};
import.meta.hot?.dispose(() => { disposeFocusIntent(); disposeLanguage(); });
if (controls) {
  void import('./gallery/ControlGallery.svelte').then(({ default: ControlGallery }) => {
    mount(ControlGallery, { target: document.getElementById('app')! });
  }).catch(() => {
    showBootstrapError('Nie udało się wczytać biblioteki kontrolek. Odśwież okno.');
  });
} else if (new URLSearchParams(location.search).get('dictationWidget') === '1') {
  document.documentElement.dataset.page = 'dictation-widget';
  void import('./tools/dictation/DictationWidget.svelte').then(({ default: Widget }) => mount(Widget, { target: document.getElementById('app')! })).catch(() => {
    showBootstrapError('Nie udało się wczytać okna dyktowania.');
  });
} else {
  void import('./App.svelte').then(({ default: App }) => mount(App, { target: document.getElementById('app')! })).catch(() => {
    showBootstrapError('Nie udało się wczytać studia. Uruchom aplikację ponownie.');
  });
}
