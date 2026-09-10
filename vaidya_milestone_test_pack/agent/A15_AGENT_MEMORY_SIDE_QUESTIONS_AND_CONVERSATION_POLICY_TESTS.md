# A15 Tests - Memory and Side Questions

1. Booking has collected doctor/date; side fee question should not clear collected fields.
2. Booking/ASK_TIME + `Sunday open-a?` answers Sunday timing and asks time again.
3. Booking/PROPOSE_SLOTS + `Parking irukka?` answers KB and repeats slot choices.
4. Booking/ASK_PATIENT_NAME + `Clinic enga?` answers location and asks name again.
5. Booking with held slot + `Receptionist kitta pesanum` releases hold and starts handoff.
6. Booking with held slot + `vendam` releases hold and ends booking.
7. Compound correction: user changes date after slots proposed; old slot choices cleared and slots recomputed.
8. No duplicate appointment after side question and confirmation.
