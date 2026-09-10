# A18 Tests - Language Variation Library

1. Add `vendaam` to no_words and verify booking confirmation cancels booking.
2. Add `saringa` to yes_words and verify confirmation works.
3. Add `nalikki` to tomorrow_words and verify ASK_DATE parses tomorrow.
4. Reviewed example export includes context_flow/current_state.
5. Long arbitrary sentence is not added to language pack automatically.
6. Adding language-pack entry does not require BookingMachine code change.
7. New language can be inserted with template/language pack rows without state-machine rewrite.
