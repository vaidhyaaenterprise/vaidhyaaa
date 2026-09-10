# A13 Tests - Capability Registry

1. `Fees evlo?` maps to ask_fee source=structured_db.
2. `Sunday open-a?` maps to ask_timing source=structured_db.
3. `Parking irukka?` maps to ask_previsit_instruction source=approved_knowledge.
4. `Receptionist kitta pesanum` maps to ask_human_agent creates callback_request.
5. `Chest pain` maps emergency creates emergency_incident.
6. `Fever-ku enna tablet` maps medical_advice_request fixed_template.
7. `Cricket score` maps out_of_scope fixed_template.
8. During booking, fee capability answers and resumes.
9. During booking, human capability ends/pauses booking and starts handoff.
10. During booking, emergency ends unsafe continuation.
