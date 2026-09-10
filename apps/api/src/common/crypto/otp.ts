import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOtp(length = 6): string {
  let otp = '';
  for (let index = 0; index < length; index += 1) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
}

export function hashOtp(otp: string, pepper: string): string {
  return createHash('sha256').update(`${otp}.${pepper}`).digest('hex');
}

export function verifyOtp(otp: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashOtp(otp, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}