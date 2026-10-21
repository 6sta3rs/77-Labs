// Browser integration check. Run in an isolated preview profile on the Vite server:
// await (await import('/scripts/theme-check.js')).checkThemes()
export async function checkThemes() {
  const checks = []
  const assert = (name, passed) => { checks.push({ name, passed: !!passed }); if (!passed) throw new Error(name) }
  const wait = () => new Promise(resolve => setTimeout(resolve, 50))
  const exactButton = (label, root = document) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === label)
  const fill = (selector, value) => { const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }
  const click = async node => { if (!node) throw new Error('Brak kontrolki'); node.click(); await wait() }
  const submit = async () => { document.querySelector('dialog form').requestSubmit(); await wait() }
  const { loadAppearance } = await import('../src/lib/appearance')
  const library = await import('../src/lib/themes/library')
  const keys = ['voicestudio.appearance.v2', library.THEME_LIBRARY_KEY]
  const originals = keys.map(key => [key, localStorage.getItem(key)])
  let exported
  try {
    if (!exactButton('Wygląd')) await click(document.querySelector('button[aria-label="Ustawienia"]'))
    await click(exactButton('Wygląd'))
    await click(exactButton('Przywróć', document.querySelector('.appearance-header')))
    await click(document.querySelector('[data-theme-id="ocean"] .theme-orb'))
    assert('Choosing a light half preserves the dark half', loadAppearance().lightTheme === 'ocean' && loadAppearance().darkTheme === 'studio')
    assert('Choosing the inactive half preserves the current mode and canvas', document.documentElement.dataset.colormode === 'dark' && getComputedStyle(document.body).backgroundColor === 'rgb(10, 10, 10)')
    await click([...document.querySelectorAll('.mode-card')].find(node => node.textContent.includes('Jasny')))
    assert('Switching mode uses its assigned palette', document.documentElement.dataset.theme === 'ocean')
    await click(document.querySelector('[data-theme-id="studio"] .theme-orb[aria-label$="ciemnym"]'))
    assert('Mixed selections persist in appearance storage', JSON.parse(localStorage.getItem(keys[0])).lightTheme === 'ocean' && JSON.parse(localStorage.getItem(keys[0])).darkTheme === 'studio')

    const initialCount = library.getThemes().length
    await click(document.querySelector('[aria-label="Kopiuj motyw Ocean"]'))
    fill('#theme-name', 'Motyw testowy'); fill('#color-canvas', '#123456'); await wait()
    assert('Editor has a live local preview', getComputedStyle(document.querySelector('.palette-preview')).backgroundColor === 'rgb(18, 52, 86)')
    await click(exactButton('Anuluj', document.querySelector('dialog')))
    assert('Cancelling a duplicate leaves the library and palette intact', library.getThemes().length === initialCount && library.getTheme('ocean').colors.canvas !== '#123456')
    await click(document.querySelector('[aria-label="Kopiuj motyw Ocean"]'))
    fill('#theme-name', 'Motyw testowy'); fill('#color-canvas', '#123456'); await submit()
    const copy = library.getThemes().find(theme => theme.label === 'Motyw testowy')
    assert('Duplicate saves both variants under a new id', copy && copy.id !== 'ocean' && copy.colors.canvas === '#123456' && !!copy.variants.dark)
    assert('Saved custom palette is applied', document.documentElement.dataset.theme === copy.id && getComputedStyle(document.body).backgroundColor === 'rgb(18, 52, 86)')
    await click(document.querySelector('[aria-label="Edytuj motyw Motyw testowy"]'))
    fill('#color-canvas', 'var(--background)'); await submit()
    assert('Invalid colors are rejected without changing the saved palette', document.querySelector('dialog [role="alert"]') && library.getTheme(copy.id).colors.canvas === '#123456')
    fill('#color-canvas', '#654321'); await submit()
    assert('Editing updates the same custom theme', library.getThemes().length === initialCount + 1 && library.getTheme(copy.id).colors.canvas === '#654321')
    exported = library.serializeTheme(library.getTheme(copy.id))
    assert('Export round-trips through the compatible theme JSON v1 parser', library.parseThemeFile(exported).colors.canvas === '#654321')
    await click(document.querySelector('[aria-label="Eksportuj motyw Motyw testowy"]'))
    assert('Export reports a prepared JSON download', document.querySelector('.theme-message')?.textContent.includes('eksport'))

    await click(exactButton('Dodaj motyw'))
    fill('#theme-json', '{'); await submit()
    assert('Malformed JSON stays in the import dialog with a readable error', document.querySelector('dialog [role="alert"]')?.textContent.includes('JSON'))
    const singleId = `test-${crypto.randomUUID()}`
    fill('#theme-json', JSON.stringify({ version: 1, id: singleId, name: 'Tylko ciemny', appearance: 'dark', colors: { canvas: '#151923' } })); await submit()
    assert('A single-mode import preserves the other half', loadAppearance().lightTheme === copy.id && loadAppearance().darkTheme === singleId)
    assert('Missing variants are shown as unavailable', document.querySelector(`[data-theme-id="${singleId}"] .unavailable`) && document.querySelectorAll(`[data-theme-id="${singleId}"] button.theme-orb`).length === 1)
    await click(document.querySelector('[aria-label="Edytuj motyw Tylko ciemny"]'))
    await click(exactButton('Jasny', document.querySelector('dialog')))
    await click(exactButton('Dodaj wariant', document.querySelector('dialog'))); await submit()
    assert('The editor can add a missing variant', !!library.getTheme(singleId).variants.light)

    await click(document.querySelector('[aria-label="Usuń motyw Tylko ciemny"]'))
    await click(exactButton('Anuluj', document.querySelector('dialog')))
    assert('Cancelling deletion preserves the theme', !!library.getTheme(singleId))
    await click(document.querySelector('[aria-label="Usuń motyw Tylko ciemny"]'))
    await click(exactButton('Usuń motyw', document.querySelector('dialog')))
    assert('Deleting an active theme resets its assigned halves', !library.getTheme(singleId) && loadAppearance().lightTheme === 'studio' && loadAppearance().darkTheme === 'studio')

    await click(exactButton('Utwórz motyw'))
    fill('#theme-name', 'Nowy od podstaw'); await submit()
    assert('Create theme saves a new editable pair', !!library.getThemes().find(theme => theme.label === 'Nowy od podstaw')?.variants.dark)
    const invalidFiles = [
      { version: 2, name: 'X', appearance: 'dark', colors: { canvas: '#000000' } },
      { version: 1, id: 'studio', name: 'X', appearance: 'dark', colors: { canvas: '#000000' } },
      { version: 1, name: 'X', appearance: 'dark', colors: { bogus: '#000000' } },
      { version: 1, name: 'X', appearance: 'dark', colors: { canvas: 'url(https://example.com)' } },
    ]
    assert('Unsupported versions, reserved ids, unknown roles and nonliteral colors are rejected', invalidFiles.every(file => { try { library.parseThemeFile(JSON.stringify(file)); return false } catch { return true } }))
    assert('Oversized import text is rejected', (() => { try { library.parseThemeFile(' '.repeat(library.MAX_THEME_BYTES + 1)); return false } catch { return true } })())
    await click(exactButton('Dodaj motyw'))
    const fileInput = document.querySelector('dialog input[type="file"]')
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify({version:1,id:`file-${crypto.randomUUID()}`,name:'Motyw z pliku',appearance:'dark',colors:{canvas:'#172635'}})], 'motyw.json', {type:'application/json'}))
    fileInput.files = transfer.files; fileInput.dispatchEvent(new Event('change', {bubbles:true})); await wait(); await submit()
    assert('Import accepts an actual JSON file', !!library.getThemes().find(theme => theme.label === 'Motyw z pliku'))
    const setItem = Storage.prototype.setItem
    try {
      Storage.prototype.setItem = function() { throw new DOMException('Quota exceeded', 'QuotaExceededError') }
      const before = document.documentElement.dataset.theme
      await click(document.querySelector('[data-theme-id="studio"] .theme-name'))
      assert('Storage errors are visible and do not silently change the active palette', document.querySelector('.theme-error')?.textContent.includes('zapisać') && document.documentElement.dataset.theme === before)
    } finally { Storage.prototype.setItem = setItem }
    assert('Theme dialogs close after saving', !document.querySelector('dialog[open]'))
    return { passed: checks.length, checks, exported }
  } catch (error) { return { error: String(error), checks } }
  finally {
    for (const [key, value] of originals) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) }
  }
}
