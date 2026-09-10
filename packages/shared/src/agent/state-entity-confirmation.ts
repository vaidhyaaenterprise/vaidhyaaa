import type { StateEntityExtractorResult } from './state-entity-types';

export function isStateEntityYesConfirmation(result: StateEntityExtractorResult): boolean {
  return result.recognizedAs === 'yes_confirmation';
}

export function isStateEntityNoRejection(result: StateEntityExtractorResult): boolean {
  return result.recognizedAs === 'no_rejection' || result.recognizedAs === 'flow_cancel';
}

export type TerminalAckTransition =
  | 'offer_help'
  | 'thank_you'
  | 'ask_what_help'
  | 'greeting'
  | 'none';

export function resolveTerminalAckTransition(
  awaitingTerminalAck: string,
  result: StateEntityExtractorResult,
): TerminalAckTransition | null {
  if (isStateEntityYesConfirmation(result)) {
    if (
      awaitingTerminalAck === 'booking_complete' ||
      awaitingTerminalAck === 'unsupported_service' ||
      awaitingTerminalAck === 'greeting_ack'
    ) {
      return 'offer_help';
    }
    if (awaitingTerminalAck === 'offer_help') {
      return 'ask_what_help';
    }
    return 'thank_you';
  }

  if (isStateEntityNoRejection(result) && awaitingTerminalAck === 'offer_help') {
    return 'thank_you';
  }

  return null;
}
