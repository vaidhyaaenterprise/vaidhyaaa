# Application Test Cases by Milestone

## P00 App Shell
- Admin nav shows Home, Call inbox, Appointments, Clinic setup, Knowledge base.
- Doctor nav hides Call inbox and Knowledge base.
- Direct URL access to admin-only route is blocked for doctor.

## P01 Clinic Setup
- Admin edits agent settings.
- Doctor cannot edit agent settings.
- Admin creates doctor without login.
- Admin links doctor login later.
- Admin configures service, doctor-service mapping, fees, booking rule.
- Schedule change with conflicts shows conflict list.
- Holiday change with conflicts shows conflict list.

## P02 Appointments
- Pending confirmation table shows reason_for_visit.
- Confirm action changes status to confirmed.
- Doctor sees only own appointments.
- Mark visited requires visit reason.
- Manual appointment outside hours requires admin override reason.
- More-than-1-hour edit opens cancel/rebook flow.
- Action requests show in Reschedule / cancel section.

## P03 Knowledge
- Add manual Q&A pending_review.
- Approve Q&A.
- Disable Q&A.
- Upload DOCX creates review rows.
- Doctor cannot access Knowledge base.

## P04 Call Inbox / Home
- Admin sees calls.
- Doctor cannot see calls.
- Recording signed URL hidden after expiry.
- Transcript hidden after expiry.
- Home shows emergency and pending actions.

## P05 Settings
- Agent enable blocked if onboarding incomplete.
- Agent enabled stores clinic_settings.agent_enabled.
- Language default can switch between ta_tanglish and english.
- Plan limit errors are shown.

