import { z } from 'zod';

export const NOTIFICATION_EVENT_STATUSES = [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
] as const;

export const NOTIFICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'dashboard'] as const;

export const NOTIFICATION_RECIPIENT_TYPES = [
  'patient',
  'clinic_admin',
  'doctor',
  'platform_admin',
] as const;

/** Platform convention for notification_events.event_type values. */
export const NOTIFICATION_EVENT_TYPES = [
  'appointment.pending_confirmation',
  'appointment.confirmed',
  'appointment.cancelled',
  'appointment.rescheduled',
  'appointment.reminder',
  'staff.pending_appointment',
  'staff.action_request',
  'staff.callback_request',
  'staff.emergency_alert',
  'patient.otp',
] as const;

export const notificationEventStatusSchema = z.enum(NOTIFICATION_EVENT_STATUSES);
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export const notificationRecipientTypeSchema = z.enum(NOTIFICATION_RECIPIENT_TYPES);
export const notificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES);

export type NotificationEventStatus = z.infer<typeof notificationEventStatusSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationRecipientType = z.infer<typeof notificationRecipientTypeSchema>;
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;
