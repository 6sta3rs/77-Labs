# Parametry syntezy mowy

`AdvancedSpeechSettings.svelte` pokazuje opcje wybranego adaptera,
a `speech-settings.ts` waliduje je i serializuje do multipart `/generate`.
Szybkość, kroki i seed pozostają podstawowymi ustawieniami generacji.

## Możliwości silnika

Klient ma jawną mapę dokładnych identyfikatorów adapterów. Nie wywodzi obsługi
parametrów z nazwy modelu ani samej flagi emocji. Po zmianie archiwum backendu
mapa wymaga ponownego sprawdzenia.

| Adapter | Dodatkowe pola |
| --- | --- |
| OmniVoice i wariant subprocess | Instrukcja, guidance, t-shift, odszumianie, postprocess, kara warstw i temperatury. |
| OmniVoice GGUF | Instrukcja i odszumianie. |
| VoxCPM2 | Instrukcja i guidance. |
| CosyVoice | Instrukcja przy potwierdzonej referencji. |
| Adapter bez zweryfikowanej mapy | Bez dodatkowych kontrolek modelu. |

Wspólne pola obejmują długość fragmentu, crossfade i słownik wymowy.
Wartość długości 0 wyłącza dzielenie. Puste nadpisanie numeryczne zachowuje
ustawienie silnika. Walidacja odrzuca NaN, nieskończoność, niepoprawne zakresy
i zerowy t-shift. Ukryte pola nie trafiają do żądania po zmianie modelu.
Instrukcje OmniVoice mają własną taksonomię, odrębną od swobodnych opisów
innych silników.

WAV, głosy wbudowane i szkic projektowania wymagają odkrycia rzeczywistego
kontraktu źródeł: [parametry 0.5.7](parametry-wav-0.5.7.md).
Dla wielu mówców metadane silnika i ustawienia są zamrażane na początku zadania,
żeby zmiana UI nie zmieniała kolejnych bloków trwającej generacji.

## Strumień a gotowy WAV

Backend może obsługiwać `stream=true` jako NDJSON z ramkami start/chunk/done/error.
Klient oczekujący gotowego Blob WAV nie może otrzymać takiego strumienia.
HTTP 200 nie dowodzi ukończenia, jeśli późniejsza ramka zawiera błąd.
Odsłuch audiobooka ma osobną [kolejkę porcji](audiobook-porcjami.md).

Regresja bez modeli: `node scripts/speech-settings-check.mjs`.
Check/build i test serializacji nie potwierdzają brzmienia parametrów;
wymagany jest osobny odbiór na wybranym modelu.
