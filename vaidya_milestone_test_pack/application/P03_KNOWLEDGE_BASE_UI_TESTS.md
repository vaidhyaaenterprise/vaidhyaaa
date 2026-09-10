# P03 Knowledge Base UI - What to Test and How

## Goal
Verify knowledge base UI manages approved Q&A only, upload/review workflow, manual Q&A, edits, approvals, and language readiness.

## Admin visibility

```text
[ ] Knowledge tab visible to clinic_admin
[ ] Knowledge tab hidden from doctor
```

## Manual Q&A

```text
[ ] Admin can add one question + answer
[ ] New Q&A defaults to pending_review unless explicitly approved by allowed admin action
[ ] Required fields validated
[ ] Category can be selected
[ ] Alternative phrases can be added
```

## DOCX upload

```text
[ ] Upload accepts DOCX template
[ ] knowledge_file row created
[ ] Processing status displayed
[ ] Parsed rows appear as pending_review
[ ] Uploaded rows are never auto-approved
[ ] Errors are shown clearly
```

## Review and approval

```text
[ ] Single approve works
[ ] Bulk approve works
[ ] Edit before approval works
[ ] Edit after approval creates version/audit if implemented
[ ] Disable Q&A works; no hard delete
[ ] pending_review answers are not used by runtime
```

## Structured-data separation

UI should not ask for these in knowledge templates:

```text
[ ] doctor fees
[ ] doctor schedules
[ ] clinic hours
[ ] holidays
[ ] service routing data
[ ] clinic address if stored structurally
```

Knowledge should focus on:

```text
[ ] parking
[ ] first visit documents
[ ] scan/test preparation
[ ] insurance/cashless explanation
[ ] report collection process
[ ] clinic-specific FAQs
```

## Language readiness

```text
[ ] Existing ta_tanglish and english templates/answers can be shown
[ ] UI is ready for future language additions
[ ] Missing translation is clearly indicated, not silently guessed
```

## Pass condition

P03 passes when admin can manage approved Q&A safely and the UI does not mix operational setup data with knowledge base content.
