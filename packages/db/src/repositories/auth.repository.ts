import { and, eq, gt, isNull, or } from 'drizzle-orm';

import type { Database } from '../client';
import { clinicUsers, otpChallenges, users } from '../schema';

export class AuthRepository {
  constructor(private readonly db: Database) {}

  findUserById(userId: string) {
    return this.db.select().from(users).where(eq(users.id, userId)).limit(1);
  }

  findUserByIdentifier(identifier: string) {
    return this.db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.phone, identifier)))
      .limit(1);
  }

  findUserByEmailOrPhone(identifier: string) {
    return this.findUserByIdentifier(identifier);
  }

  findUserByEmail(email: string) {
    return this.db.select().from(users).where(eq(users.email, email)).limit(1);
  }

  findUserByUsername(username: string) {
    return this.db.select().from(users).where(eq(users.username, username)).limit(1);
  }

  findUserByUsernameOrEmail(identifier: string) {
    return this.db
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);
  }

  touchUserLastLogin(userId: string) {
    return this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  listActiveClinicMemberships(userId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(and(eq(clinicUsers.userId, userId), eq(clinicUsers.active, true)));
  }

  findClinicMembership(userId: string, clinicId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(and(eq(clinicUsers.userId, userId), eq(clinicUsers.clinicId, clinicId)))
      .limit(1);
  }

  updateUserActive(userId: string, active: boolean) {
    return this.db.update(users).set({ active }).where(eq(users.id, userId)).returning();
  }

  updateClinicMembershipActive(clinicId: string, membershipId: string, active: boolean) {
    return this.db
      .update(clinicUsers)
      .set({ active })
      .where(and(eq(clinicUsers.clinicId, clinicId), eq(clinicUsers.id, membershipId)))
      .returning();
  }

  listClinicUsers(clinicId: string) {
    return this.db
      .select({
        membership: clinicUsers,
        user: users,
      })
      .from(clinicUsers)
      .innerJoin(users, eq(clinicUsers.userId, users.id))
      .where(eq(clinicUsers.clinicId, clinicId));
  }

  findClinicMembershipById(clinicId: string, membershipId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(and(eq(clinicUsers.clinicId, clinicId), eq(clinicUsers.id, membershipId)))
      .limit(1);
  }

  createOtpChallenge(input: {
    identifier: string;
    otpHash: string;
    expiresAt: Date;
  }) {
    return this.db
      .insert(otpChallenges)
      .values({
        identifier: input.identifier,
        otpHash: input.otpHash,
        purpose: 'login',
        expiresAt: input.expiresAt,
      })
      .returning({ id: otpChallenges.id });
  }

  findActiveOtpChallenge(challengeId: string) {
    return this.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.id, challengeId),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1);
  }

  consumeOtpChallenge(challengeId: string) {
    return this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challengeId));
  }
}
