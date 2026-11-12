export function normalizeLoginPrefix(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/[._-]{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
}

export function composeClinicUsername(prefix: string, clinicLoginNumber: string): string {
  const normalized = normalizeLoginPrefix(prefix);
  return normalized && clinicLoginNumber ? `${normalized}.${clinicLoginNumber}` : normalized;
}

export function extractLoginPrefix(username: string | null, clinicLoginNumber: string): string {
  if (!username) {
    return '';
  }

  const marker = `.${clinicLoginNumber}`;
  const markerIndex = username.toLowerCase().indexOf(marker.toLowerCase());
  return normalizeLoginPrefix(markerIndex >= 0 ? username.slice(0, markerIndex) : username);
}
