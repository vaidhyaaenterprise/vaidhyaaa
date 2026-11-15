# Vaidhyaa Premium Design Preview

This is an isolated, dependency-free application design prototype. It does not import production modules, call the Vaidhyaa API, or use the production authentication storage keys.

## Open locally

From the repository root:

```bash
python3 -m http.server 4173 --directory prototypes/vaidhyaa-premium
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/).

## What to review

- Public login and registration entry, followed by scrollable product storytelling
- Clinic administrator routes: Home, Call Inbox, Appointments, Patient History, Clinic Setup, Settings and Knowledge Base
- Doctor workspace: Today, Analytics, Patient History, personal schedule and preferences
- Internal platform routes: Clinic Operations, Job Health and Notification Operations
- Manual appointment, patient history, reschedule, visit completion and confirmation dialogs
- Desktop, tablet and mobile navigation patterns
- Premium Clinic Setup → User Management with doctor/admin account lists, role filters, account creation, one-time credential handoff, credential editing and protected deletion
- Loading/permission/conflict/read-only/prototype maturity language

Use the **Preview as** control in the application header to switch personas. All records, names, identifiers and phone numbers are synthetic, and every mutation is simulated.

Direct review states:

- [User Management](http://127.0.0.1:4173/?preview=clinic-users)
- [Create doctor login](http://127.0.0.1:4173/?preview=clinic-user-create)
- [Create clinic-admin login](http://127.0.0.1:4173/?preview=clinic-user-create-admin)
- [Edit login credentials](http://127.0.0.1:4173/?preview=clinic-user-edit)
- [One-time credential handoff](http://127.0.0.1:4173/?preview=clinic-user-credentials)
- [Delete-login confirmation](http://127.0.0.1:4173/?preview=clinic-user-delete)

## Boundaries

- Existing application routes, API behavior, RBAC and business logic are unchanged.
- This prototype intentionally excludes Call Inbox recordings and transcripts, removed quick filters, a separate Services screen, Answering Mode, Fallback Phone, notification-channel selection and Test Notification.
- Doctor Analytics and DOCX knowledge import are explicitly labeled as demo or incomplete.
- A production implementation should begin only after the visual direction is approved.

Figma capture file: [Vaidhyaa Premium Application Design Preview](https://www.figma.com/design/ME8aFwXyRpC0o7BlN12Lac)
