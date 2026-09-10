import { z } from 'zod';

/** Stable message template keys used by the agent and notification system. */
export const MESSAGE_TEMPLATE_KEYS = [
  'booking.greeting',
  'booking.ask_problem_or_doctor',
  'booking.ask_date',
  'booking.ask_time',
  'booking.propose_slots',
  'booking.ask_patient_name',
  'booking.ask_phone',
  'booking.confirm_details',
  'booking.confirm_doctor',
  'booking.slot_unavailable',
  'booking.thank_you',
  'booking.created_pending',
  'booking.created_confirmed',
  'booking.unsupported_service',
  'booking.flow_cancelled',
  'booking.ask_reason',
  'booking.ask_alternate_time',
  'booking.offer_help',
  'booking.ask_what_help',
  'booking.ask_service_clarification',
  'fee.answer',
  'fee.followup_answer',
  'fee.ask_doctor',
  'fee.not_found',
  'timing.answer',
  'timing.day_answer',
  'timing.day_closed',
  'location.answer',
  'availability.today_slots',
  'availability.no_slots',
  'availability.not_available',
  'knowledge.answer',
  'knowledge.no_answer',
  'cancel.confirm',
  'cancel.completed',
  'cancel.not_cancelled',
  'cancel.no_appointment_found',
  'cancel.select_appointment',
  'cancel.request_submitted',
  'reschedule.ask_new_date',
  'reschedule.ask_new_time',
  'reschedule.propose_slots',
  'reschedule.confirm',
  'reschedule.completed',
  'reschedule.not_changed',
  'reschedule.request_submitted',
  'handoff.ask_reason',
  'handoff.ask_name',
  'handoff.ask_phone',
  'handoff.created',
  'handoff.cancelled',
  'safety.emergency',
  'safety.medical_advice_refusal',
  'unknown.clarify',
  'language.switched',
  'llm.retry_request',
  'llm.callback_fallback',
  'scope.out_of_scope_redirect',
  'scope.unsupported_service',
  'scope.staff_confirm_and_resume',
  'scope.staff_confirm_offer_callback',
  'scope.resume_booking_prompt',
  'safety.medical_advice_refusal_resume',
  'safety.emergency_active_flow',
  'handoff.started_from_active_flow',
  'ack.thanks_offer_help',
  'ack.okay_offer_help',
  'clarify.which_detail',
  'clarify.which_detail_resume',
  'scope.out_of_scope',
  'scope.out_of_scope_resume',
  'side.answer_and_resume',
  'medical.refusal_resume',
  'handoff.start_from_interruption',
  'booking.resume.problem_or_doctor',
  'booking.resume.date',
  'booking.resume.time',
  'booking.resume.slot_selection',
  'booking.resume.name',
  'booking.resume.confirm',
  'unknown.help_options',
] as const;

export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const messageTemplateKeySchema = z.enum(MESSAGE_TEMPLATE_KEYS);

export const messageTemplateResponseSchema = z.object({
  template_key: messageTemplateKeySchema,
  language_code: z.string().min(1),
  template_text: z.string().min(1),
  required_variables_json: z.array(z.string()),
});

export type MessageTemplateResponse = z.infer<typeof messageTemplateResponseSchema>;

export const TEMPLATE_LANGUAGES = ['ta_tanglish', 'english'] as const;
export type TemplateLanguageCode = (typeof TEMPLATE_LANGUAGES)[number];

type TemplateRegistry = Record<MessageTemplateKey, Record<TemplateLanguageCode, string>>;

export const CODE_TEMPLATE_REGISTRY: TemplateRegistry = {
  'booking.greeting': {
    ta_tanglish:
      'Vanakkam. {clinic_name} Vaidya pesuren. Enna problem-ku appointment venum?',
    english: 'Hello. This is Vaidya from {clinic_name}. What problem do you need the appointment for?',
  },
  'booking.ask_problem_or_doctor': {
    ta_tanglish: 'Endha doctor-a paakanum? Illena enna problem-ku appointment venum?',
    english: 'Which doctor would you like to see, or what problem do you need help with?',
  },
  'booking.ask_date': {
    ta_tanglish: 'Enna date-ku appointment venum?',
    english: 'Which date would you like the appointment for?',
  },
  'booking.ask_time': {
    ta_tanglish: '{time_options} prefer panreenga?',
    english: 'Which time do you prefer: {time_options}?',
  },
  'booking.propose_slots': {
    ta_tanglish: '{doctor_name} {date_display} {slot_list} slots irukku. Edha choose panreenga?',
    english: '{doctor_name} has these slots on {date_display}: {slot_list}. Which one do you prefer?',
  },
  'booking.ask_patient_name': {
    ta_tanglish: 'Patient name sollunga.',
    english: 'Please share the patient name.',
  },
  'booking.ask_phone': {
    ta_tanglish: 'Contact number sollunga.',
    english: 'Please share a contact phone number.',
  },
  'booking.confirm_details': {
    ta_tanglish: 'Details correct-a irukka? Confirm pannunga.',
    english: 'Please confirm these appointment details.',
  },
  'booking.confirm_doctor': {
    ta_tanglish:
      '{doctor_name}-a appointment book pannalama? {date_display} {slot_time}-ku slot ready.',
    english:
      'Should I book the appointment with {doctor_name} on {date_display} at {slot_time}?',
  },
  'booking.slot_unavailable': {
    ta_tanglish:
      'Sorry, antha slot book aagiruchu. Vera slot choose pannunga: {slot_list}',
    english:
      'Sorry, that slot is no longer available. Please choose another slot: {slot_list}',
  },
  'booking.thank_you': {
    ta_tanglish: 'Seri, thanks.',
    english: 'Okay, thank you.',
  },
  'booking.created_pending': {
    ta_tanglish: 'Unga appointment request create panniten. Clinic staff confirm pannuvanga.',
    english: 'Your appointment request has been created. Clinic staff will confirm shortly.',
  },
  'booking.created_confirmed': {
    ta_tanglish: 'Unga appointment confirm aayiduchu.',
    english: 'Your appointment is confirmed.',
  },
  'booking.unsupported_service': {
    ta_tanglish: 'Indha clinic-la intha service handle panna maatanga.',
    english: 'This clinic does not handle that service.',
  },
  'booking.flow_cancelled': {
    ta_tanglish: 'Booking flow cancel panniten.',
    english: 'The booking flow has been cancelled.',
  },
  'booking.ask_reason': {
    ta_tanglish: 'Enna problem-ku appointment venum?',
    english: 'What problem do you need the appointment for?',
  },
  'booking.ask_alternate_time': {
    ta_tanglish: 'Indha date/time-ku slots illa. Vera date or time sollunga.',
    english: 'No slots are available for that date or time. Please suggest another date or time.',
  },
  'booking.offer_help': {
    ta_tanglish: 'Vera edhavadhu help venuma?',
    english: 'Do you need any other help?',
  },
  'booking.ask_what_help': {
    ta_tanglish: 'Ungaluku enna help venum?',
    english: 'What help do you need?',
  },
  'booking.ask_service_clarification': {
    ta_tanglish: '{clarification_question}',
    english: '{clarification_question}',
  },
  'fee.answer': {
    ta_tanglish: '{doctor_name} consultation fee {fee_amount} irukku.',
    english: '{doctor_name} consultation fee is {fee_amount}.',
  },
  'fee.followup_answer': {
    ta_tanglish: '{doctor_name} follow-up fee {fee_amount} irukku.',
    english: '{doctor_name} follow-up fee is {fee_amount}.',
  },
  'fee.ask_doctor': {
    ta_tanglish: 'Edha doctor fees venum?',
    english: 'Which doctor fee do you need?',
  },
  'fee.not_found': {
    ta_tanglish: 'Fee details indha doctor-ku available illa.',
    english: 'Fee details are not available for that doctor.',
  },
  'timing.answer': {
    ta_tanglish: 'Clinic timing {timing_text}.',
    english: 'Clinic hours are {timing_text}.',
  },
  'timing.day_answer': {
    ta_tanglish: '{day_name} clinic {timing_text}.',
    english: 'On {day_name}, clinic hours are {timing_text}.',
  },
  'timing.day_closed': {
    ta_tanglish: '{day_name} clinic closed.',
    english: 'The clinic is closed on {day_name}.',
  },
  'location.answer': {
    ta_tanglish: 'Clinic address: {clinic_address}.',
    english: 'Clinic address: {clinic_address}.',
  },
  'availability.today_slots': {
    ta_tanglish: '{doctor_name} {date_label} {slot_list} slots irukku.',
    english: '{doctor_name} has these slots on {date_label}: {slot_list}.',
  },
  'availability.no_slots': {
    ta_tanglish: 'Indha date-ku slots illa.',
    english: 'No slots are available for that date.',
  },
  'availability.not_available': {
    ta_tanglish: '{doctor_name} indha date-ku available illa.',
    english: '{doctor_name} is not available on that date.',
  },
  'knowledge.answer': {
    ta_tanglish: '{answer_text}',
    english: '{answer_text}',
  },
  'knowledge.no_answer': {
    ta_tanglish: 'Indha detail clinic staff confirm pannuvanga.',
    english: 'Clinic staff will confirm this.',
  },
  'cancel.confirm': {
    ta_tanglish: 'Appointment cancel panna confirm pannureengala?',
    english: 'Do you want to cancel this appointment?',
  },
  'cancel.completed': {
    ta_tanglish: 'Appointment cancel panniten.',
    english: 'Your appointment has been cancelled.',
  },
  'cancel.not_cancelled': {
    ta_tanglish: 'Appointment cancel pannala.',
    english: 'The appointment was not cancelled.',
  },
  'cancel.no_appointment_found': {
    ta_tanglish: 'Matching appointment kidaikkala.',
    english: 'No matching appointment was found.',
  },
  'cancel.select_appointment': {
    ta_tanglish: 'Unga upcoming appointments: {appointment_list}. Edha cancel pannanum?',
    english: 'Your upcoming appointments: {appointment_list}. Which one should I cancel?',
  },
  'cancel.request_submitted': {
    ta_tanglish: 'Cancel request create panniten. Clinic staff confirm pannuvanga.',
    english: 'Your cancel request has been submitted. Clinic staff will confirm.',
  },
  'reschedule.ask_new_date': {
    ta_tanglish: 'New date enna venum?',
    english: 'Which new date would you like?',
  },
  'reschedule.ask_new_time': {
    ta_tanglish: 'New time preference enna?',
    english: 'What time would you prefer?',
  },
  'reschedule.propose_slots': {
    ta_tanglish: 'Indha slots available: {slot_list}.',
    english: 'These slots are available: {slot_list}.',
  },
  'reschedule.confirm': {
    ta_tanglish: 'Reschedule details correct-a?',
    english: 'Please confirm the reschedule details.',
  },
  'reschedule.completed': {
    ta_tanglish: 'Appointment reschedule panniten.',
    english: 'Your appointment has been rescheduled.',
  },
  'reschedule.not_changed': {
    ta_tanglish: 'Appointment change pannala.',
    english: 'The appointment was not changed.',
  },
  'reschedule.request_submitted': {
    ta_tanglish: 'Reschedule request create panniten. Clinic staff confirm pannuvanga.',
    english: 'Your reschedule request has been submitted. Clinic staff will confirm.',
  },
  'handoff.ask_reason': {
    ta_tanglish: 'Clinic staff-kitta pesanum-na reason sollunga.',
    english: 'Please tell me why you want to speak with clinic staff.',
  },
  'handoff.ask_name': {
    ta_tanglish: 'Unga name sollunga.',
    english: 'Please share your name.',
  },
  'handoff.ask_phone': {
    ta_tanglish: 'Callback number sollunga.',
    english: 'Please share a callback number.',
  },
  'handoff.created': {
    ta_tanglish: 'Clinic staff unga callback request receive pannuvanga.',
    english: 'Clinic staff will receive your callback request.',
  },
  'handoff.cancelled': {
    ta_tanglish: 'Handoff request cancel panniten.',
    english: 'The handoff request was cancelled.',
  },
  'safety.emergency': {
    ta_tanglish:
      'Idhu emergency-a irukkalaam. Please immediate-a 108-ku call pannunga illa nearest hospital-ku ponga.',
    english:
      'This may be an emergency. Please call 108 immediately or go to the nearest hospital.',
  },
  'safety.medical_advice_refusal': {
    ta_tanglish:
      'Naan medical advice kudukka mudiyadhu. Doctor consult panna appointment book panna help panren.',
    english:
      'I cannot provide medical advice. I can help you book a doctor consultation.',
  },
  'unknown.clarify': {
    ta_tanglish: 'Sorry, puriyala. Appointment, fees, timing, location-a help panna mudiyum.',
    english: 'Sorry, I did not understand. I can help with appointments, fees, timing, or location.',
  },
  'language.switched': {
    ta_tanglish: 'Tamil/Tanglish-la continue pannalaam.',
    english: 'Sure, we can continue in English.',
  },
  'llm.retry_request': {
    ta_tanglish:
      'Sorry, system konjam slow-a irukku. Unga message-a oru murai repeat pannunga.',
    english: 'Sorry, the system is a bit slow. Please repeat your message once.',
  },
  'llm.callback_fallback': {
    ta_tanglish:
      'Sorry, system work aagala. Konjam nerathula call pannunga. Clinic staff-a notify pannirukken.',
    english:
      'Sorry, the system is not working right now. Please call back later. We have notified clinic staff.',
  },
  'scope.out_of_scope_redirect': {
    ta_tanglish:
      'Naan clinic reception assistant. Appointments, fees, timing, location mattum help panna mudiyum.',
    english:
      'I am the clinic reception assistant. I can help only with appointments, fees, timing, and location.',
  },
  'scope.unsupported_service': {
    ta_tanglish:
      'Indha service inga available illa. Clinic-la support panna service sollunga, naan help panren.',
    english:
      'That service is not available here. Tell me a service this clinic supports and I can help.',
  },
  'scope.staff_confirm_and_resume': {
    ta_tanglish: 'Indha detail clinic staff confirm pannuvanga.',
    english: 'Clinic staff will confirm this detail.',
  },
  'scope.staff_confirm_offer_callback': {
    ta_tanglish:
      'Indha detail clinic staff confirm pannuvanga. Callback venumna sollunga.',
    english: 'Clinic staff will confirm this. Say if you want a callback.',
  },
  'scope.resume_booking_prompt': {
    ta_tanglish: 'Appointment flow continue pannalaam.',
    english: 'We can continue the appointment flow.',
  },
  'safety.medical_advice_refusal_resume': {
    ta_tanglish:
      'Naan medical advice kudukka mudiyadhu. Doctor consult panna appointment book panna help panren.',
    english:
      'I cannot provide medical advice. I can help you book a doctor consultation.',
  },
  'safety.emergency_active_flow': {
    ta_tanglish:
      'Idhu emergency-a irukkalaam. Please immediate-a 108-ku call pannunga illa nearest hospital-ku ponga.',
    english:
      'This may be an emergency. Please call 108 immediately or go to the nearest hospital.',
  },
  'handoff.started_from_active_flow': {
    ta_tanglish: 'Clinic staff-kitta pesanum-na reason sollunga.',
    english: 'Please tell me why you want to speak with clinic staff.',
  },
  'ack.thanks_offer_help': {
    ta_tanglish: 'Seri, nandri. Vera help venuma?',
    english: 'Thank you. Do you need any other help?',
  },
  'ack.okay_offer_help': {
    ta_tanglish: 'Okay. Vera help venuma?',
    english: 'Okay. Do you need any other help?',
  },
  'clarify.which_detail': {
    ta_tanglish:
      'Seri. Fees, timing, location, doctor availability, parking, insurance, scan preparation madhiri details help panna mudiyum. Endha detail venum?',
    english:
      'Sure. I can help with fees, timing, location, doctor availability, parking, insurance, or scan preparation. Which detail do you need?',
  },
  'clarify.which_detail_resume': {
    ta_tanglish:
      'Seri. Fees, timing, location, doctor availability, parking, insurance, scan preparation madhiri details help panna mudiyum. Endha detail venum?',
    english:
      'Sure. I can help with fees, timing, location, doctor availability, parking, insurance, or scan preparation. Which detail do you need?',
  },
  'scope.out_of_scope': {
    ta_tanglish:
      'Adha naan help panna mudiyadhu. Clinic appointment, fees, timing, location, doctor availability madhiri details-ku help panna mudiyum.',
    english:
      'I cannot help with that. I can help with clinic appointments, fees, timing, location, and doctor availability.',
  },
  'scope.out_of_scope_resume': {
    ta_tanglish:
      'Adha naan help panna mudiyadhu. Clinic appointment, fees, timing, location, doctor availability madhiri details-ku help panna mudiyum. {resume_prompt}',
    english:
      'I cannot help with that. I can help with clinic appointments and clinic information. {resume_prompt}',
  },
  'side.answer_and_resume': {
    ta_tanglish: '{answer_text} {resume_prompt}',
    english: '{answer_text} {resume_prompt}',
  },
  'medical.refusal_resume': {
    ta_tanglish:
      'Naan medicine advice kudukka mudiyadhu. Doctor consult panna appointment book panna help panren. {resume_prompt}',
    english:
      'I cannot provide medical advice. I can help you book an appointment with the doctor. {resume_prompt}',
  },
  'handoff.start_from_interruption': {
    ta_tanglish: 'Clinic staff-kitta pesanum-na reason sollunga.',
    english: 'Please tell me why you want to speak with clinic staff.',
  },
  'booking.resume.problem_or_doctor': {
    ta_tanglish: 'Appointment-ku endha doctor illa enna problem-nu sollunga?',
    english: 'For the appointment, which doctor or what problem should I note?',
  },
  'booking.resume.date': {
    ta_tanglish: 'Appointment-ku endha date venum?',
    english: 'Which date do you need the appointment for?',
  },
  'booking.resume.time': {
    ta_tanglish: 'Morning illa evening prefer panreenga?',
    english: 'Do you prefer morning or evening?',
  },
  'booking.resume.slot_selection': {
    ta_tanglish: 'Indha slots-la edha choose panreenga?',
    english: 'Which of these slots would you like?',
  },
  'booking.resume.name': {
    ta_tanglish: 'Appointment-ku unga peyar sollunga.',
    english: 'Please share your name for the appointment.',
  },
  'booking.resume.confirm': {
    ta_tanglish: 'Appointment request create pannalama?',
    english: 'Should I create the appointment request?',
  },
  'unknown.help_options': {
    ta_tanglish: 'Appointment, fees, timing, location, doctor availability-a help panna mudiyum. Enna help venum?',
    english: 'I can help with appointments, fees, timing, location, or doctor availability. What do you need?',
  },
};

export function getCodeTemplateText(
  templateKey: MessageTemplateKey,
  languageCode: string,
): string | null {
  const entry = CODE_TEMPLATE_REGISTRY[templateKey];
  if (!entry) {
    return null;
  }
  if (languageCode in entry) {
    return entry[languageCode as TemplateLanguageCode];
  }
  return entry.english;
}

export function assertTemplateRegistryComplete(): void {
  for (const key of MESSAGE_TEMPLATE_KEYS) {
    const entry = CODE_TEMPLATE_REGISTRY[key];
    if (!entry) {
      throw new Error(`Missing code template registry entry for ${key}`);
    }
    for (const language of TEMPLATE_LANGUAGES) {
      if (!entry[language]?.trim()) {
        throw new Error(`Missing ${language} template for ${key}`);
      }
    }
  }
}
