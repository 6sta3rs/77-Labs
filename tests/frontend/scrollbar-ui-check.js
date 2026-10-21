// Run against the real UI in an isolated browser profile, including open dialogs.
// No backend writes, storage changes or model operations.
export function checkScrollbars(root = document) {
  const webkit = CSS.supports('selector(::-webkit-scrollbar)');
  const rows = [...root.querySelectorAll('*')].filter(element => {
    const style = getComputedStyle(element);
    return /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)
      && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
      && element.getClientRects().length > 0;
  }).map(element => {
    const style = getComputedStyle(element);
    const scrollbar = getComputedStyle(element, '::-webkit-scrollbar');
    const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
    const buttons = getComputedStyle(element, '::-webkit-scrollbar-button');
    const passed = webkit
      ? style.scrollbarWidth === 'auto' && style.scrollbarColor === 'auto'
        && scrollbar.width === '8px' && scrollbar.height === '8px'
        && buttons.display === 'none' && thumb.backgroundColor !== 'rgba(0, 0, 0, 0)'
      : style.scrollbarWidth === 'thin' && style.scrollbarColor !== 'auto';
    return { element: `${element.tagName.toLowerCase()}.${String(element.className).split(/\s+/)[0]}`,
      passed, width: style.scrollbarWidth, color: style.scrollbarColor,
      trackWidth: scrollbar.width, trackHeight: scrollbar.height,
      thumb: thumb.backgroundColor, buttons: buttons.display };
  });
  if (!rows.length) throw Error('Brak przewijanych obszarów do sprawdzenia.');
  return { passed: rows.every(row => row.passed), total: rows.length, rows };
}
