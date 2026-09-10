# A18 - Language Variation Library and Review Loop

## Purpose

Create a maintainable way to improve spelling/phrase variation support without building an endless phrase database.

## Principle

Do not store every user phrase as an intent rule.

Store only:

1. Small language-pack helpers for deterministic fast-path parsing.
2. Reviewed examples for evaluation/few-shot prompt improvement.
3. Clinic-specific service profiles and approved knowledge.

## Implement

1. Add/extend language_pack_configs admin/internal maintenance.
2. Add reviewed_examples table or file-based dataset generation.
3. Add command to propose additions to language packs from reviewed examples.
4. Add tests so adding a new spelling improves active-state parser.

## `reviewed_examples` fields

```text
id
language_code
message_text_redacted
context_flow
context_state
expected_recognized_as
expected_intent
expected_entities_json
source
approved_for_prompt_examples boolean
created_at
```

## Allowed additions to language pack

Add only high-confidence, reusable tokens:

- common yes/no/cancel terms
- today/tomorrow terms
- morning/evening terms
- common confirmation words

Do not add every problem phrase or every long sentence.

## Training decision

Do not fine-tune now. Reconsider only after enough labelled real messages exist.

Suggested threshold before fine-tuning discussion:

- 1000+ reviewed utterances
- stable taxonomy
- clear model failure pattern
- no safety regressions

## Acceptance

- New variation can be added to language pack without changing state machine.
- Reviewed examples update evaluation dataset.
- No giant runtime phrase table is introduced.
