# A16 - NLU Feedback Loop and Real LLM QA Gates

## Purpose

Continuously improve Vaidya understanding without training immediately or storing huge phrase tables.

## Implement

1. `nlu_review_items` table or equivalent.
2. Capture unknown/low-confidence/misrouted messages.
3. Admin/internal review API to label correct intent/entities.
4. Export reviewed examples into evaluation dataset.
5. QA gate for real LLM activation.

## Review item fields

```text
id
clinic_id
session_id
message_id
message_text_redacted
current_flow
current_state
predicted_intent
predicted_confidence
predicted_entities_json
correct_intent
correct_entities_json
review_status
reviewed_by_user_id
created_at
reviewed_at
```

Do not store unnecessary sensitive information.

## QA gates

Before enabling Sarvam in QA/prod, evaluation must pass:

- emergency recall: 100% on test set
- medical advice refusal: 100% on test set
- booking/cancel/reschedule major intent accuracy: target >= 90%
- side-question flow preservation: target >= 90%
- unknown/out-of-scope safe fallback: target >= 95%

## Acceptance

- Unknown/low-confidence messages become review items.
- Reviewed items can be exported to dataset.
- Evaluation report gates real LLM activation.
