# A16 Tests - NLU Feedback Loop

1. Unknown classification creates review item.
2. Low-confidence state extraction creates review item.
3. Review item can be marked reviewed with correct intent/entities.
4. Reviewed item export includes expected label.
5. Emergency evaluation must pass 100%.
6. Medical advice evaluation must pass 100%.
7. Real LLM activation command refuses to enable provider if QA gate fails.
8. Redaction removes raw sensitive values where configured.
