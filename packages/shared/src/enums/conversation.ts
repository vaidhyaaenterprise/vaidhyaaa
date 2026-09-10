import { z } from 'zod';

export const CONVERSATION_FLOWS = [
  'none',
  'booking',
  'cancel',
  'reschedule',
  'handoff',
  'emergency',
  'fee_clarification',
] as const;

export const CONVERSATION_SESSION_STATUSES = [
  'active',
  'completed',
  'escalated',
  'abandoned',
  'expired',
] as const;

export const CONVERSATION_CHANNELS = [
  'web_demo',
  'voice_call',
  'whatsapp',
  'admin_test',
] as const;

export const CONVERSATION_MESSAGE_SENDERS = ['patient', 'assistant', 'system'] as const;

/** Known conversation state identifiers; additional states may be added by the agent runtime. */
export const CONVERSATION_STATES = [
  'IDLE',
  'COLLECTING_PROBLEM',
  'COLLECTING_DOCTOR',
  'PROPOSING_SLOTS',
  'CONFIRMING_BOOKING',
  'HANDOFF',
] as const;

export const conversationFlowSchema = z.enum(CONVERSATION_FLOWS);
export const conversationSessionStatusSchema = z.enum(CONVERSATION_SESSION_STATUSES);
export const conversationChannelSchema = z.enum(CONVERSATION_CHANNELS);
export const conversationMessageSenderSchema = z.enum(CONVERSATION_MESSAGE_SENDERS);
export const conversationStateSchema = z.string().min(1);

export type ConversationFlow = z.infer<typeof conversationFlowSchema>;
export type ConversationSessionStatus = z.infer<typeof conversationSessionStatusSchema>;
export type ConversationChannel = z.infer<typeof conversationChannelSchema>;
export type ConversationMessageSender = z.infer<typeof conversationMessageSenderSchema>;
