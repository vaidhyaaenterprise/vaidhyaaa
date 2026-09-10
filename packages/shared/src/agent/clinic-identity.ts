export function isClinicIdentityQuestion(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return (
    /\b(ithu|idhu|indha|this is|is this|is it|right clinic|correct clinic)\b/i.test(normalized) &&
    /\b(clinic|hospital)\b/i.test(normalized)
  );
}

export function messageReferencesClinicName(messageText: string, clinicName: string): boolean {
  const message = messageText.toLowerCase();
  const words = clinicName
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ''))
    .filter((word) => word.length > 2 && !['clinic', 'hospital', 'the'].includes(word));

  if (words.length === 0) {
    return message.includes(clinicName.toLowerCase());
  }

  return words.some((word) => message.includes(word));
}

export function shouldTryKnowledgeBeforeClarify(intent: string, messageText: string): boolean {
  const normalized = messageText.trim();
  if (!normalized || normalized.length < 4) {
    return false;
  }
  if (intent !== 'unknown') {
    return false;
  }
  if (/^(hi+|hello+|hey+|vanakkam|namaste)\b/i.test(normalized)) {
    return false;
  }
  return true;
}
