import type { AppointmentCandidate } from '@vaidya/shared';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function formatAppointmentList(candidates: AppointmentCandidate[]): string {
  return candidates.map((candidate) => candidate.display_label).join('; ');
}

export function parseAppointmentSelection(
  messageText: string,
  candidates: AppointmentCandidate[],
): string | null {
  const normalized = normalize(messageText);
  const numberMatch = normalized.match(/^(\d+)$/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    return candidates[index]?.appointment_id ?? null;
  }

  for (const candidate of candidates) {
    const doctorFragment = candidate.doctor_name.toLowerCase().replace(/^dr\.?\s*/i, '').trim();
    if (doctorFragment && normalized.includes(doctorFragment)) {
      return candidate.appointment_id;
    }
    const datePart = candidate.appointment_start.split(' ')[0] ?? '';
    if (datePart && normalized.includes(datePart)) {
      return candidate.appointment_id;
    }
  }

  return null;
}
