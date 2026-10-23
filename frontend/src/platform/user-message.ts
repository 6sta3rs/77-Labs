// Turns a caught value into text safe to show: known technical errors become clear Polish messages,
// readable (Polish) messages pass through, anything else gets the caller's fallback. Never returns stack traces or class names.
// Returns Polish source text; wrap with tr()/translateUi() at the call site.
const rules: [RegExp, string][] = [
  [/AbortError|request (was )?cancell?ed|aborted|operation was canceled/i, 'Operację anulowano.'],
  [/TimeoutError|timed? ?out|timeout/i, 'Silnik nie odpowiedział na czas. Spróbuj ponownie.'],
  [/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ECONNRESET|connection (refused|reset)|network request failed/i, 'Nie można połączyć się z silnikiem. Sprawdź, czy działa, i spróbuj ponownie.'],
  [/QuotaExceededError|quota/i, 'Brak miejsca na zapis. Zwolnij miejsce i spróbuj ponownie.'],
  [/\b(401|403)\b|unauthori[sz]ed|forbidden/i, 'Brak uprawnień do wykonania tej operacji.'],
  [/\b404\b|not found/i, 'Nie znaleziono żądanego zasobu.'],
  [/\b(5\d\d)\b|internal server error|bad gateway|service unavailable/i, 'Silnik zgłosił błąd wewnętrzny. Spróbuj ponownie.'],
  [/Unexpected token|Unexpected end of JSON|JSON\.parse|is not valid JSON|SyntaxError|JSON at position/i, 'Otrzymano nieprawidłową odpowiedź. Spróbuj ponownie.'],
  [/Traceback|^\s*File "|\bat \S+ \(|\.py\b|\bTypeError\b|\bReferenceError\b|\bRangeError\b|\bundefined\b|\[object /i, ''],
];
const polish = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const english = /\b(the|is|are|was|not|failed|cannot|can't|unable|invalid|missing|expected|must|error|exception|denied|unsupported)\b/i;
const className = /\b[A-Z][A-Za-z]*(Error|Exception)\b/;

export function userMessage(error: unknown, fallback: string): string {
  const raw = (error instanceof Error ? error.message || error.name : typeof error === 'string' ? error : '').trim();
  const name = error instanceof Error ? error.name : '';
  const text = `${name} ${raw}`;
  for (const [pattern, reply] of rules) if (pattern.test(text)) return reply || fallback;
  if (!raw || className.test(raw) || (!polish.test(raw) && english.test(raw))) return fallback;
  return raw.split('\n')[0].slice(0, 300);
}
