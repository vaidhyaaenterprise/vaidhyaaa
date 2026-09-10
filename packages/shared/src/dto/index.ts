export const DTO_PACKAGE_VERSION = '0.1.0';

export * from './common';

export {
  createConversationSessionSchema,
  sendConversationMessageSchema,
  type CreateConversationSessionInput,
  type SendConversationMessageInput,
} from './conversation-api';

export {
  createPlatformClinicNestedSchema,
  createPlatformClinicSchema,
  disableUserSchema,
  forgotPasswordSchema,
  inviteClinicAdminSchema,
  meClinicMembershipSchema,
  meResponseSchema,
  meUserSchema,
  parseCreatePlatformClinicBody,
  registerClinicAdminResponseSchema,
  registerClinicAdminSchema,
  requestOtpSchema,
  resendPasswordResetCodeSchema,
  resendVerificationCodeSchema,
  resetPasswordSchema,
  sendVerificationCodeSchema,
  updateMembershipSchema,
  verifyEmailSchema,
  verifyOtpSchema,
  verifyPasswordResetCodeSchema,
  type CreatePlatformClinicInput,
  type CreatePlatformClinicNestedInput,
  type DisableUserInput,
  type ForgotPasswordInput,
  type InviteClinicAdminInput,
  type MeResponse,
  type RegisterClinicAdminInput,
  type RegisterClinicAdminResponse,
  type RequestOtpInput,
  type ResetPasswordInput,
  type ResendPasswordResetCodeInput,
  type ResendVerificationCodeInput,
  type SendVerificationCodeInput,
  type UpdateMembershipInput,
  type VerifyEmailInput,
  type VerifyOtpInput,
  type VerifyPasswordResetCodeInput,
} from './auth';

export {
  clinicUserResponseSchema,
  createClinicUserLoginSchema,
  inviteClinicUserSchema,
  loginWithUsernamePasswordSchema,
  type ClinicUserResponse,
  type CreateClinicUserLoginInput,
  type InviteClinicUserInput,
  type LoginWithUsernamePasswordInput,
} from './clinic-users';

export {
  clinicSettingsPatchSchema,
  clinicSettingsPutSchema,
  clinicSettingsResponseSchema,
  clinicSettingsSummarySchema,
  ANSWERING_MODES,
  type ClinicSettingsPatchInput,
  type ClinicSettingsPutInput,
  type ClinicSettingsResponse,
  type ClinicSettingsSummary,
} from './clinic-settings';

export {
  createDoctorSchema,
  doctorResponseSchema,
  linkDoctorLoginSchema,
  updateDoctorSchema,
  type CreateDoctorInput,
  type DoctorResponse,
  type LinkDoctorLoginInput,
  type UpdateDoctorInput,
} from './doctor';

export {
  addDoctorScheduleWindowSchema,
  disableDoctorScheduleWindowSchema,
  doctorScheduleResponseSchema,
  patchDoctorScheduleWindowSchema,
  replaceDoctorSchedulesSchema,
  type AddDoctorScheduleWindowInput,
  type DoctorScheduleResponse,
  type PatchDoctorScheduleWindowInput,
  type ReplaceDoctorSchedulesInput,
} from './doctor-schedule';

export {
  createDoctorServiceMappingSchema,
  doctorServiceMappingResponseSchema,
  updateDoctorServiceMappingSchema,
  type CreateDoctorServiceMappingInput,
  type DoctorServiceMappingResponse,
  type UpdateDoctorServiceMappingInput,
} from './doctor-service-mapping';

export {
  bookingRuleResponseSchema,
  createBookingRuleSchema,
  updateBookingRuleSchema,
  type BookingRuleResponse,
  type CreateBookingRuleInput,
  type UpdateBookingRuleInput,
} from './doctor-service-booking-rule';

export {
  addClinicHoursWindowSchema,
  clinicHolidayResponseSchema,
  clinicHoursResponseSchema,
  createClinicHolidaySchema,
  disableClinicHoursWindowSchema,
  patchClinicHolidaySchema,
  patchClinicHoursWindowSchema,
  replaceClinicHoursSchema,
  type AddClinicHoursWindowInput,
  type ClinicHolidayResponse,
  type ClinicHoursResponse,
  type CreateClinicHolidayInput,
  type PatchClinicHolidayInput,
  type PatchClinicHoursWindowInput,
  type ReplaceClinicHoursInput,
} from './clinic-hours-holidays';

export {
  appointmentResponseSchema,
  createAppointmentRequestSchema,
  manualAppointmentCreateSchema,
  markAppointmentVisitedSchema,
  patchAppointmentRequestSchema,
  type AppointmentResponse,
  type CreateAppointmentRequestInput,
  type ManualAppointmentCreateInput,
  type MarkAppointmentVisitedInput,
  type PatchAppointmentRequestInput,
} from './appointment';

export {
  appointmentActionRequestResponseSchema,
  createAppointmentActionRequestSchema,
  patchAppointmentActionRequestSchema,
  resolveAppointmentActionRequestSchema,
  type AppointmentActionRequestResponse,
  type CreateAppointmentActionRequestInput,
  type PatchAppointmentActionRequestInput,
  type ResolveAppointmentActionRequestInput,
} from './appointment-action-request';

export {
  conflictPreviewResponseSchema,
  scheduleConflictItemSchema,
  type ConflictPreviewResponse,
  type ScheduleConflictItem,
} from './conflicts';

export {
  clinicLanguageItemSchema,
  clinicLanguagesResponseSchema,
  clinicSubscriptionResponseSchema,
  clinicUsageResponseSchema,
  platformSubscriptionChangeSchema,
  replaceClinicLanguagesSchema,
  supportedLanguageResponseSchema,
  type ClinicLanguagesResponse,
  type ClinicSubscriptionResponse,
  type ClinicUsageResponse,
  type PlatformSubscriptionChangeInput,
  type ReplaceClinicLanguagesInput,
} from './clinic-languages-subscription';

export {
  conversationMessageResponseSchema,
  conversationSessionResponseSchema,
  createConversationMessageSchema,
  type ConversationMessageResponse,
  type ConversationSessionResponse,
  type CreateConversationMessageInput,
} from './conversation-message';

export {
  createKnowledgeEntrySchema,
  knowledgeEntryResponseSchema,
  knowledgeFileResponseSchema,
  knowledgeTranslationResponseSchema,
  patchKnowledgeEntrySchema,
  type CreateKnowledgeEntryInput,
  type KnowledgeEntryResponse,
  type KnowledgeFileResponse,
  type KnowledgeTranslationResponse,
  type PatchKnowledgeEntryInput,
} from './knowledge';

export {
  exportNluReviewItemsSchema,
  nluReviewCaptureReasonSchema,
  nluReviewStatusSchema,
  patchNluReviewItemSchema,
  type NluReviewExportCase,
  type PatchNluReviewItemInput,
} from './nlu-review';

export {
  addLanguagePackWordsSchema,
  createLanguagePackSchema,
  createReviewedExampleSchema,
  type AddLanguagePackWordsInput,
  type CreateLanguagePackInput,
  type CreateReviewedExampleInput,
} from './reviewed-examples';

export {
  callInboxItemSchema,
  callInboxListResponseSchema,
  callTranscriptEntrySchema,
  type CallInboxItem,
  type CallInboxListResponse,
  type CallTranscriptEntry,
} from './call-inbox';

export {
  voiceCallEventSchema,
  voiceIncomingCallResponseSchema,
  voiceIncomingCallSchema,
  voiceRecordingReadySchema,
  voiceTranscriptTurnSchema,
  type VoiceCallEventInput,
  type VoiceIncomingCallInput,
  type VoiceIncomingCallResponse,
  type VoiceRecordingReadyInput,
  type VoiceTranscriptTurnInput,
} from './voice-api';

export {
  createNotificationEventSchema,
  notificationEventResponseSchema,
  type CreateNotificationEventInput,
  type NotificationEventResponse,
} from './notification';
