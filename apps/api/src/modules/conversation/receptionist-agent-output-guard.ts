export type AgentToolResultRecord = {
  toolName: string;
  result: Record<string, unknown>;
};

export type AllowedFactSnapshot = {
  feeAmounts: Set<string>;
  timeTokens: Set<string>;
  doctorNameTokens: Set<string>;
  addressTokens: Set<string>;
};

const FEE_IN_REPLY_PATTERN = /₹\s*([\d,]+)/g;
const TIME_IN_REPLY_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
const DOCTOR_IN_REPLY_PATTERN = /\bdr\.?\s*([a-z][a-z.]+)/gi;

function normalizeAmount(value: string): string {
  return value.replace(/,/g, '').trim();
}

function normalizeDoctorToken(value: string): string {
  return value.toLowerCase().replace(/^dr\.?\s*/, '').replace(/\./g, '').trim();
}

function normalizeTimeToken(hour: string, minute: string | undefined, meridiem: string | undefined): string {
  let h = Number(hour);
  const m = minute ?? '00';
  const mer = meridiem?.toLowerCase();
  if (mer === 'pm' && h < 12) {
    h += 12;
  }
  if (mer === 'am' && h === 12) {
    h = 0;
  }
  return `${h}:${m.padStart(2, '0')}`;
}

function addFeeToken(snapshot: AllowedFactSnapshot, value: unknown) {
  if (value === null || value === undefined) {
    return;
  }
  const raw = String(value);
  const normalized = normalizeAmount(raw.replace(/[₹\s]/g, ''));
  if (normalized) {
    snapshot.feeAmounts.add(normalized);
  }
}

function addTimeToken(snapshot: AllowedFactSnapshot, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }
  const text = value.trim().toLowerCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    snapshot.timeTokens.add(text);
    return;
  }
  snapshot.timeTokens.add(
    normalizeTimeToken(match[1]!, match[2], match[3]),
  );
  if (match[2]) {
    snapshot.timeTokens.add(`${match[1]}:${match[2]}`);
  }
  snapshot.timeTokens.add(match[1]!);
}

function addDoctorToken(snapshot: AllowedFactSnapshot, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }
  const token = normalizeDoctorToken(value);
  if (token) {
    snapshot.doctorNameTokens.add(token);
    for (const part of token.split(/\s+/)) {
      if (part.length > 2) {
        snapshot.doctorNameTokens.add(part);
      }
    }
  }
}

function addAddressTokens(snapshot: AllowedFactSnapshot, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }
  const normalized = value.toLowerCase();
  snapshot.addressTokens.add(normalized);
  for (const part of normalized.split(/[,\s]+/).filter((token) => token.length > 3)) {
    snapshot.addressTokens.add(part);
  }
}

export function buildAllowedFactSnapshot(input: {
  toolResults: AgentToolResultRecord[];
  collected: Record<string, unknown>;
}): AllowedFactSnapshot {
  const snapshot: AllowedFactSnapshot = {
    feeAmounts: new Set<string>(),
    timeTokens: new Set<string>(),
    doctorNameTokens: new Set<string>(),
    addressTokens: new Set<string>(),
  };

  for (const entry of input.toolResults) {
    const result = entry.result;
    if (entry.toolName === 'get_clinic_info') {
      addFeeToken(snapshot, result.consultationFee);
      addFeeToken(snapshot, result.followupFee);
      addAddressTokens(snapshot, result.address);
      addAddressTokens(snapshot, result.hoursSummary);
      addAddressTokens(snapshot, result.hours);
    }
    if (entry.toolName === 'check_slot_availability' && Array.isArray(result.slots)) {
      for (const slot of result.slots as Array<Record<string, unknown>>) {
        addTimeToken(snapshot, slot.time);
        addDoctorToken(snapshot, slot.doctorName);
      }
    }
    if (entry.toolName === 'create_appointment_request') {
      addDoctorToken(snapshot, result.doctorName);
    }
  }

  addDoctorToken(snapshot, input.collected.doctor_name);
  const proposedSlots = input.collected.proposed_slots;
  if (Array.isArray(proposedSlots)) {
    for (const slot of proposedSlots as Array<Record<string, unknown>>) {
      addTimeToken(snapshot, slot.display_time);
      addTimeToken(snapshot, slot.start_time);
    }
  }

  return snapshot;
}

function feeIsGrounded(amount: string, snapshot: AllowedFactSnapshot): boolean {
  const normalized = normalizeAmount(amount);
  return snapshot.feeAmounts.has(normalized);
}

function timeIsGrounded(hour: string, minute: string | undefined, meridiem: string | undefined, snapshot: AllowedFactSnapshot): boolean {
  if (snapshot.timeTokens.size === 0) {
    return true;
  }
  const canonical = normalizeTimeToken(hour, minute, meridiem);
  const compact = minute ? `${hour}:${minute}` : hour;
  return (
    snapshot.timeTokens.has(canonical) ||
    snapshot.timeTokens.has(compact.toLowerCase()) ||
    snapshot.timeTokens.has(hour)
  );
}

function doctorIsGrounded(name: string, snapshot: AllowedFactSnapshot): boolean {
  if (snapshot.doctorNameTokens.size === 0) {
    return true;
  }
  const token = normalizeDoctorToken(name);
  return (
    snapshot.doctorNameTokens.has(token) ||
    [...snapshot.doctorNameTokens].some((allowed) => token.includes(allowed) || allowed.includes(token))
  );
}

function addressIsGrounded(fragment: string, snapshot: AllowedFactSnapshot): boolean {
  if (snapshot.addressTokens.size === 0) {
    return true;
  }
  const lower = fragment.toLowerCase();
  return [...snapshot.addressTokens].some((allowed) => lower.includes(allowed) || allowed.includes(lower));
}

export function detectUngroundedFacts(
  replyText: string,
  snapshot: AllowedFactSnapshot,
): string[] {
  const violations: string[] = [];

  if (snapshot.feeAmounts.size > 0 || /₹|fee|consultation/i.test(replyText)) {
    for (const match of replyText.matchAll(FEE_IN_REPLY_PATTERN)) {
      const amount = match[1];
      if (amount && !feeIsGrounded(amount, snapshot)) {
        violations.push(`fee:₹${amount}`);
      }
    }
    if (/₹|fee|consultation/i.test(replyText) && snapshot.feeAmounts.size === 0) {
      violations.push('fee:mentioned_without_tool');
    }
  }

  if (snapshot.timeTokens.size > 0) {
    for (const match of replyText.matchAll(TIME_IN_REPLY_PATTERN)) {
      const hour = match[1];
      const minute = match[2];
      const meridiem = match[3];
      if (!hour) {
        continue;
      }
      if (Number(hour) > 23) {
        continue;
      }
      if (!timeIsGrounded(hour, minute, meridiem, snapshot)) {
        violations.push(`time:${hour}${minute ? `:${minute}` : ''}${meridiem ?? ''}`);
      }
    }
  }

  for (const match of replyText.matchAll(DOCTOR_IN_REPLY_PATTERN)) {
    const name = match[1];
    if (name && !doctorIsGrounded(name, snapshot)) {
      violations.push(`doctor:${name}`);
    }
  }

  const addressLike = replyText.match(/\b\d+[\s,]+[A-Za-z][A-Za-z\s,]{8,}/);
  if (addressLike?.[0] && !addressIsGrounded(addressLike[0], snapshot)) {
    violations.push('address:ungrounded');
  }

  return violations;
}

export const UNGROUNDED_REPLY_FALLBACK =
  'Let me verify the exact clinic details for you. Are you asking about fees, timings, or booking an appointment?';
