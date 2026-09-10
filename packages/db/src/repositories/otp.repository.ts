import { and, desc, eq, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { otpTokens } from '../schema';

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export class OtpRepository {
  constructor(private readonly db: Database) {}

  insert(input: {
    email: string;
    otpHash: string;
    purpose: OtpPurpose;
    expiresAt: Date;
  }) {
    return this.db
      .insert(otpTokens)
      .values({
        email: input.email,
        otpHash: input.otpHash,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
      })
      .returning();
  }

  findLatestForEmail(email: string, purpose: OtpPurpose) {
    return this.db
      .select()
      .from(otpTokens)
      .where(and(eq(otpTokens.email, email), eq(otpTokens.purpose, purpose)))
      .orderBy(desc(otpTokens.createdAt))
      .limit(1);
  }

  incrementAttempts(id: string) {
    return this.db
      .update(otpTokens)
      .set({ attempts: sql`${otpTokens.attempts} + 1` })
      .where(eq(otpTokens.id, id))
      .returning();
  }

  setAttempts(id: string, attempts: number) {
    return this.db
      .update(otpTokens)
      .set({ attempts })
      .where(eq(otpTokens.id, id))
      .returning();
  }

  markVerified(id: string) {
    return this.db
      .update(otpTokens)
      .set({ verifiedAt: new Date(), usedAt: new Date() })
      .where(eq(otpTokens.id, id))
      .returning();
  }

  markVerifiedOnly(id: string) {
    return this.db
      .update(otpTokens)
      .set({ verifiedAt: new Date() })
      .where(eq(otpTokens.id, id))
      .returning();
  }

  markUsed(id: string) {
    return this.db
      .update(otpTokens)
      .set({ usedAt: new Date() })
      .where(eq(otpTokens.id, id))
      .returning();
  }

  invalidateAllForEmail(email: string, purpose: OtpPurpose) {
    return this.db
      .update(otpTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(otpTokens.email, email), eq(otpTokens.purpose, purpose)));
  }
}