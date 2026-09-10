import type { BookingCollected } from '../booking/collected';
import type { StateEntityExtractorResult } from './state-entity-types';
import { resolveTerminalAckTransition } from './state-entity-confirmation';

export type TerminalAckOutcome =
  | { kind: 'offer_help' }
  | { kind: 'thank_you' }
  | { kind: 'ask_what_help' }
  | { kind: 'greeting' }
  | { kind: 'unhandled' };

export function resolveTerminalAckOutcome(
  awaitingTerminalAck: string,
  result: StateEntityExtractorResult,
): TerminalAckOutcome {
  if (awaitingTerminalAck === 'awaiting_help_topic') {
    return { kind: 'greeting' };
  }

  const transition = resolveTerminalAckTransition(awaitingTerminalAck, result);
  if (transition === 'offer_help') {
    return { kind: 'offer_help' };
  }
  if (transition === 'thank_you') {
    return { kind: 'thank_you' };
  }
  if (transition === 'ask_what_help') {
    return { kind: 'ask_what_help' };
  }

  return { kind: 'unhandled' };
}

export function readAwaitingTerminalAck(
  collected: BookingCollected | Record<string, unknown>,
): string | undefined {
  const value =
    (collected as BookingCollected).awaiting_terminal_ack ??
    (collected as Record<string, unknown>).awaiting_terminal_ack;
  return typeof value === 'string' ? value : undefined;
}
