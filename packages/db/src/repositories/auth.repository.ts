import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';

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
    const normalized = username.trim().toLowerCase();
    return this.db
      .select()
      .from(users)
      .where(sql<boolean>`lower(${users.username}) = ${normalized}`)
      .limit(1);
  }

  findUserByUsernameOrEmail(identifier: string) {
    const normalized = identifier.trim().toLowerCase();
    return this.db
      .select()
      .from(users)
      .where(
        or(sql<boolean>`lower(${users.username}) = ${normalized}`, eq(users.email, normalized)),
      )
      .limit(1);
  }

  touchUserLastLogin(userId: string) {
    return this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  listActiveClinicMemberships(userId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(
        and(
          eq(clinicUsers.userId, userId),
          eq(clinicUsers.active, true),
          isNull(clinicUsers.deletedAt),
        ),
      );
  }

  findClinicMembership(userId: string, clinicId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(
        and(
          eq(clinicUsers.userId, userId),
          eq(clinicUsers.clinicId, clinicId),
          isNull(clinicUsers.deletedAt),
        ),
      )
      .limit(1);
  }

  updateUserActive(userId: string, active: boolean) {
    return this.db.update(users).set({ active }).where(eq(users.id, userId)).returning();
  }

  updateClinicMembershipActive(clinicId: string, membershipId: string, active: boolean) {
    return this.db
      .update(clinicUsers)
      .set({ active, updatedAt: new Date() })
      .where(
        and(
          eq(clinicUsers.clinicId, clinicId),
          eq(clinicUsers.id, membershipId),
          isNull(clinicUsers.deletedAt),
        ),
      )
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
      .where(and(eq(clinicUsers.clinicId, clinicId), isNull(clinicUsers.deletedAt)))
      .orderBy(asc(clinicUsers.role), asc(clinicUsers.createdAt));
  }

  findClinicMembershipById(clinicId: string, membershipId: string) {
    return this.db
      .select()
      .from(clinicUsers)
      .where(
        and(
          eq(clinicUsers.clinicId, clinicId),
          eq(clinicUsers.id, membershipId),
          isNull(clinicUsers.deletedAt),
        ),
      )
      .limit(1);
  }

  createOtpChallenge(input: { identifier: string; otpHash: string; expiresAt: Date }) {
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
