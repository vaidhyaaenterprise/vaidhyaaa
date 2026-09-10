const CONFIRMATION_PROMPT_PATTERN =
  /\b(confirm|book (it|this|you|the)|shall i|go ahead|proceed|ok to book|pannalama|pannunga|want me to book|ready to book|which slot|choose panreenga)\b/i;

const AFFIRMATIVE_REPLY_PATTERN =
  /\b(yes|yeah|yep|ok|okay|confirm|sure|seri|sari|aama|pannunga|go ahead|please do|book it|first slot|sounds good|that works)\b/i;

export function isAmbiguousShortReply(messageText: string): boolean {
  const normalized = messageText.trim().toLowerCase();
  return (
    /^(hmm|um+|ok(ay)?|so|yeah)([\s.,!]+(ok|so|yeah))?[\s.,!]*$/i.test(normalized) ||
    /^hmm\s+ok\s+so[\s.,!]*$/i.test(normalized)
  );
}

export function assistantAskedForConfirmation(
  lastAssistantMessageText: string | null | undefined,
): boolean {
  if (!lastAssistantMessageText?.trim()) {
    return false;
  }
  return CONFIRMATION_PROMPT_PATTERN.test(lastAssistantMessageText);
}

export function isAffirmativePatientReply(messageText: string): boolean {
  const trimmed = messageText.trim();
  if (!trimmed || isAmbiguousShortReply(trimmed)) {
    return false;
  }
  if (/^(yes|yeah|yep|ok|okay|confirm|sure|seri|sari|aama)\.?$/i.test(trimmed)) {
    return true;
  }
  return AFFIRMATIVE_REPLY_PATTERN.test(trimmed);
}

export function isPatientActionConfirmed(input: {
  confirmedByPatient: unknown;
  lastAssistantMessageText?: string | null;
  patientMessageText?: string | null;
}): boolean {
  if (input.confirmedByPatient !== true) {
    return false;
  }
  if (!assistantAskedForConfirmation(input.lastAssistantMessageText)) {
    return false;
  }
  if (!input.patientMessageText || !isAffirmativePatientReply(input.patientMessageText)) {
    return false;
  }
  return true;
}
