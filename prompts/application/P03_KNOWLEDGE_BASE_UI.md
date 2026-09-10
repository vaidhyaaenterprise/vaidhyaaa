# Application Milestone P03 - Knowledge Base UI

## Goal
Build the admin Knowledge Base screens.

## Scope
Knowledge base is approved Q&A only. It must not manage structured facts like fees, schedules, clinic hours, holidays, location, services, or doctor availability.

## Features
- Use Q&A template inside app.
- Upload DOCX.
- Manual Q&A add.
- Review queue.
- Bulk approve/disable.
- Single approve/edit/disable.
- Edit approved answer creates updated version or updates with audit.
- Language-specific answer support if available.

## Upload behavior
- Uploaded rows become pending_review.
- Never auto-approve uploaded Q&A.
- Parsing can be async job.

## Runtime behavior to show in UI
- approved answers can be used by Vaidya.
- pending_review answers are not used.
- disabled answers are not used.
- if no approved answer exists, Vaidya says clinic staff will confirm.

## Tests
1. Admin can add manual Q&A pending_review.
2. Admin can approve Q&A.
3. Approved Q&A appears in approved list.
4. Pending Q&A is not used by runtime.
5. Disabled Q&A is not used.
6. DOCX upload creates knowledge_file and pending rows.
7. Bulk approve works.
8. Edit approved answer writes audit log.
9. Doctor cannot access knowledge base.
10. Structured facts warning is displayed: fees/timing/schedules are configured in Clinic Setup.

## Acceptance criteria
- Knowledge base UI safely supports approved-only Q&A workflow.
