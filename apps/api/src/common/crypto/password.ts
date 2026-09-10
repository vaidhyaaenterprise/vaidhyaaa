import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const ITERATIONS = 120_000;
const KEY_LENGTH = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256').toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256'));
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function deriveLoginNumber(clinicId: string): string {
  return (
    parseInt(
      createHash('sha256')
        .update(`${clinicId}.vaidya-clinic-number`)
        .digest('hex')
        .slice(0, 8),
      16,
    ) %
    9000 +
    1000
  ).toString();
}
