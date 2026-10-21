# Opcjonalna redakcja transkrypcji

W **Mowa na tekst** przełącznik **Poproś LLM o redakcję po rozpoznaniu** jest
domyślnie wyłączony. Dotyczy następnego żądania i korzysta z wcześniej
skonfigurowanego dostawcy. Może przesłać tekst poza komputer i wykorzystać
limit tej usługi; nie wybiera dostawcy za użytkownika.

## Zastosowanie i cofnięcie

Oryginał rozpoznania i propozycja są pokazywane osobno.
**Użyj redakcji w TXT i edytorze** wybiera sugestię dla pobranego TXT i akcji
**Otwórz w edytorze**. Nie nadpisuje ręcznie edytowanej transkrypcji ani segmentów.
**Cofnij użycie redakcji** przywraca ich bieżącą wersję z zachowaniem poprawek.

SRT/VTT zawsze korzystają z segmentów i ich czasów. Sugestia LLM nie ma
alignmentu i nie jest automatycznie dzielona na napisy. Dalszą zmianę sugestii
można wykonać po jawnym otwarciu w edytorze narracji.

## Stan i ograniczenia

Backend zwraca `refined_text`, gdy redakcja zmienia tekst. Brak pola może oznaczać
brak zmiany, wyłączenie lub niedostępność LLM. UI zachowuje oryginał i nie
przypisuje statusu innego żądania do tego nagrania. Oryginał, propozycja i decyzja
mogą być zapisane w lokalnej historii; starsze wyniki bez nich są obsługiwane.

## Gdzie zmienić

- `src/lib/api.ts` — pole `refine` i odpowiedź transkrypcji.
- `src/lib/transcription.ts` — normalizacja, historia i wybór tekstu TXT.
- `src/lib/TranscriptionWorkspace.svelte` — porównanie i zastosowanie.

Regresje: `node scripts/transcription-refinement-check.mjs`
i `node scripts/transcription-check.mjs`. Test transportu z fixture nie
potwierdza ASR lub odpowiedzi zewnętrznego LLM. Odbiór powinien sprawdzić
polskie znaki, ręczne poprawki, cofnięcie, TXT/SRT/VTT i ponowne otwarcie.
Zobacz [weryfikację](weryfikacja.md) i [prywatność](../SECURITY.md).
