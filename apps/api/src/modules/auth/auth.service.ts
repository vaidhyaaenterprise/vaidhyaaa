import { createHash, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { type ApiEnv } from '@vaidya/config';
import {
  createRepositories,
  DatabaseService,
  type Repositories,
} from '@vaidya/db';
import { AppError, type AuthContext, type ClinicRole, type PlatformRole } from '@vaidya/shared';

import { hashPassword, verifyPassword } from '../../common/crypto/password';
import { generateOtp, hashOtp, verifyOtp } from '../../common/crypto/otp';
import { DEV_AUTH_HEADERS } from '../../common/constants/auth.constants';
import { API_ENV } from '../../config/api-config.module';
import { DATABASE_CONNECTION } from '../../modules/database/database.module';
import { EmailService } from '../email/email.service';
import type { DatabaseConnection, OtpPurpose } from '@vaidya/db';
import type {
  ForgotPasswordInput,
  ResetPasswordInput,
  SendVerificationCodeInput,
  VerifyEmailInput,
  VerifyOtpInput,
  VerifyPasswordResetCodeInput,
} from '../platform/platform.schemas';

const DEV_STUB_OTP = '000000';
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

export type MeResponse = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    platform_role: PlatformRole | null;
    active: boolean;
  };
  clinics: Array<{
    clinic_id: string;
    role: ClinicRole;
    doctor_id: string | null;
    active: boolean;
  }>;
};

type DevAuthHint = {
  userId?: string;
  clinicId?: string;
  clinicRole?: ClinicRole;
  doctorId?: string;
};

@Injectable()
export class AuthService {
  private readonly repos: Repositories;
  private readonly passwordResetCooldowns = new Map<string, number>();

  constructor(
    @Inject(DATABASE_CONNECTION) connection: DatabaseConnection,
    @Inject(DatabaseService) private readonly dbService: DatabaseService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {
    this.repos = createRepositories(connection.db);
  }

  assertDevAuthAllowed(): void {
    if (this.env.AUTH_MODE !== 'dev') {
      throw new AppError('FORBIDDEN', 'Dev auth is not enabled.');
    }

    if (
      this.env.NODE_ENV === 'production' ||
      this.env.APP_ENV === 'production' ||
      this.env.APP_ENV === 'staging'
    ) {
      throw new AppError('FORBIDDEN', 'Dev auth is disabled in this environment.');
    }
  }

  readDevAuthHint(request: FastifyRequest): DevAuthHint {
    const headerUserId = request.headers[DEV_AUTH_HEADERS.USER_ID];
    const headerClinicId = request.headers[DEV_AUTH_HEADERS.CLINIC_ID];
    const headerRole = request.headers[DEV_AUTH_HEADERS.USER_ROLE];
    const headerDoctorId = request.headers[DEV_AUTH_HEADERS.DOCTOR_ID];

    const userId =
      (typeof headerUserId === 'string' ? headerUserId : undefined) ?? this.env.DEV_USER_ID;
    const clinicIdFromHeader =
      typeof headerClinicId === 'string' && headerClinicId.length > 0 ? headerClinicId : undefined;
    const clinicId = clinicIdFromHeader ?? this.env.DEV_CLINIC_ID;
    const rawRole =
      (typeof headerRole === 'string' ? headerRole : undefined) ??
      this.env.DEV_USER_ROLE ??
      undefined;
    const doctorId =
      (typeof headerDoctorId === 'string' ? headerDoctorId : undefined) ?? this.env.DEV_DOCTOR_ID;

    return {
      ...(userId ? { userId } : {}),
      ...(clinicId ? { clinicId } : {}),
      ...(rawRole === 'clinic_admin' || rawRole === 'doctor' ? { clinicRole: rawRole } : {}),
      ...(doctorId ? { doctorId } : {}),
    };
  }

  async resolveAuthContext(hint: DevAuthHint): Promise<AuthContext> {
    if (!hint.userId) {
      throw new AppError('UNAUTHORIZED', 'User identity is required.');
    }

    const [user] = await this.repos.auth.findUserById(hint.userId);
    if (!user || !user.active) {
      throw new AppError('UNAUTHORIZED', 'User account is inactive or not found.');
    }

    const platformRole = user.platformRole as PlatformRole | null;
    if (platformRole === 'platform_admin' || platformRole === 'support') {
      return {
        userId: user.id,
        platformRole,
        ...(hint.clinicId ? { clinicId: hint.clinicId } : {}),
      };
    }

    const memberships = await this.repos.auth.listActiveClinicMemberships(user.id);
    if (memberships.length === 0) {
      throw new AppError('FORBIDDEN', 'User has no active clinic membership.');
    }

    const membership =
      (hint.clinicId
        ? memberships.find((row) => row.clinicId === hint.clinicId)
        : memberships[0]) ?? memberships[0];

    if (!membership?.active) {
      throw new AppError('FORBIDDEN', 'Clinic membership is inactive.');
    }

    const clinicRole = membership.role as ClinicRole;
    if (hint.clinicRole && hint.clinicRole !== clinicRole) {
      throw new AppError('FORBIDDEN', 'Requested clinic role does not match membership.');
    }

    const doctorId =
      clinicRole === 'doctor' ? (hint.doctorId ?? membership.doctorId ?? undefined) : undefined;

    if (clinicRole === 'doctor' && !doctorId) {
      throw new AppError('DOCTOR_NOT_OWNER', 'Doctor profile is not linked to this account.');
    }

    return {
      userId: user.id,
      clinicId: membership.clinicId,
      clinicRole,
      doctorId,
    };
  }

  async authenticateDevRequest(request: FastifyRequest): Promise<AuthContext> {
    this.assertDevAuthAllowed();
    const hint = this.readDevAuthHint(request);
    return this.resolveAuthContext(hint);
  }

  async authenticateBearerToken(token: string): Promise<AuthContext> {
    const userId = this.verifyAccessToken(token);
    return this.resolveAuthContext({ userId });
  }

  async getMe(auth: AuthContext): Promise<MeResponse> {
    const [user] = await this.repos.auth.findUserById(auth.userId);
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found.');
    }

    if (auth.platformRole === 'platform_admin' || auth.platformRole === 'support') {
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          platform_role: auth.platformRole,
          active: user.active,
        },
        clinics: [],
      };
    }

    const memberships = await this.repos.auth.listActiveClinicMemberships(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        platform_role: null,
        active: user.active,
      },
      clinics: memberships.map((membership) => ({
        clinic_id: membership.clinicId,
        role: membership.role as ClinicRole,
        doctor_id: membership.doctorId,
        active: membership.active,
      })),
    };
  }

  async requestOtp(identifier: string): Promise<{ challenge_id: string; expires_at: string }> {
    const [user] = await this.repos.auth.findUserByIdentifier(identifier);
    if (!user || !user.active) {
      throw new AppError('UNAUTHORIZED', 'Login is allowed only for invited users.');
    }

    const isKnownUser =
      user.platformRole === 'platform_admin' ||
      user.platformRole === 'support' ||
      (await this.repos.auth.listActiveClinicMemberships(user.id)).length > 0;

    if (!isKnownUser) {
      throw new AppError('UNAUTHORIZED', 'Login is allowed only for invited users.');
    }

    const otp = DEV_STUB_OTP;
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const [challenge] = await this.repos.auth.createOtpChallenge({
      identifier,
      otpHash: this.hashOtp(otp),
      expiresAt,
    });

    if (!challenge) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create OTP challenge.');
    }

    return {
      challenge_id: challenge.id,
      expires_at: expiresAt.toISOString(),
    };
  }

  async verifyOtp(
    input: VerifyOtpInput,
  ): Promise<{ access_token: string; user: MeResponse['user']; clinics: MeResponse['clinics'] }> {
    const [challenge] = await this.repos.auth.findActiveOtpChallenge(input.challenge_id);

    if (!challenge || !this.verifyOtpHash(input.otp, challenge.otpHash)) {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired OTP.');
    }

    await this.repos.auth.consumeOtpChallenge(challenge.id);

    const [user] = await this.repos.auth.findUserByIdentifier(challenge.identifier);
    if (!user || !user.active) {
      throw new AppError('UNAUTHORIZED', 'User account is inactive or not found.');
    }

    const auth = await this.resolveAuthContext({
      userId: user.id,
      ...(input.clinic_id ? { clinicId: input.clinic_id } : {}),
    });

    const me = await this.getMe(auth);
    return {
      access_token: this.createAccessToken(user.id),
      user: me.user,
      clinics: me.clinics,
    };
  }

  async loginWithUsernamePassword(username: string, password: string) {
    const normalized = username.trim().toLowerCase();
    const [user] = await this.repos.auth.findUserByUsernameOrEmail(normalized);
    if (!user || !user.active) {
      throw new AppError('UNAUTHORIZED', 'Invalid username or password.');
    }

    if (!user.passwordHash || !user.passwordSalt) {
      throw new AppError('UNAUTHORIZED', 'Invalid username or password.');
    }

    if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw new AppError('UNAUTHORIZED', 'Invalid username or password.');
    }

    await this.repos.auth.touchUserLastLogin(user.id);

    const auth = await this.resolveAuthContext({ userId: user.id });
    const me = await this.getMe(auth);
    return {
      access_token: this.createAccessToken(user.id),
      user: me.user,
      clinics: me.clinics,
    };
  }

  async sendVerificationCode(input: SendVerificationCodeInput): Promise<{ ok: true }> {
    const email = this.normalizeEmail(input.email);

    const [existingUser] = await this.repos.auth.findUserByEmail(email);
    if (existingUser) {
      throw new AppError('VALIDATION_ERROR', 'Email is already registered.');
    }

    await this.issueOtp(email, 'EMAIL_VERIFICATION', (otp) =>
      this.emailService.sendVerificationCode(email, otp),
    );
    return { ok: true };
  }

  async resendVerificationCode(input: SendVerificationCodeInput): Promise<{ ok: true }> {
    const email = this.normalizeEmail(input.email);

    const [existingUser] = await this.repos.auth.findUserByEmail(email);
    if (existingUser) {
      throw new AppError('VALIDATION_ERROR', 'Email is already registered.');
    }

    await this.issueOtp(email, 'EMAIL_VERIFICATION', (otp) =>
      this.emailService.sendVerificationCode(email, otp),
    );
    return { ok: true };
  }

  async verifyEmail(input: VerifyEmailInput): Promise<{ ok: true }> {
    const email = this.normalizeEmail(input.email);
    const [latest] = await this.repos.otp.findLatestForEmail(email, 'EMAIL_VERIFICATION');
    await this.verifyOtpToken(latest, input.otp, { consumeOnSuccess: true });
    return { ok: true };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<{ ok: true }> {
    await this.issuePasswordResetCode(this.normalizeEmail(input.email));
    return { ok: true };
  }

  async resendPasswordResetCode(input: ForgotPasswordInput): Promise<{ ok: true }> {
    await this.issuePasswordResetCode(this.normalizeEmail(input.email));
    return { ok: true };
  }

  async verifyPasswordResetCode(input: VerifyPasswordResetCodeInput): Promise<{ ok: true }> {
    const email = this.normalizeEmail(input.email);
    const [latest] = await this.repos.otp.findLatestForEmail(email, 'PASSWORD_RESET');
    await this.verifyOtpToken(latest, input.otp, { consumeOnSuccess: false });
    return { ok: true };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ ok: true }> {
    const email = this.normalizeEmail(input.email);
    const [latest] = await this.repos.otp.findLatestForEmail(email, 'PASSWORD_RESET');
    if (!latest) {
      throw new AppError('VALIDATION_ERROR', 'Invalid verification code.');
    }
    await this.verifyOtpToken(latest, input.otp, { consumeOnSuccess: false });

    const [user] = await this.repos.auth.findUserByEmail(email);
    if (!user || !user.active) {
      throw new AppError('VALIDATION_ERROR', 'Account not found for this email.');
    }

    const { hash, salt } = hashPassword(input.new_password);
    await this.repos.users.updatePasswordHash(user.id, { hash, salt });
    await this.repos.otp.markUsed(latest.id);
    return { ok: true };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async assertResendCooldown(email: string, purpose: OtpPurpose): Promise<void> {
    const [latest] = await this.repos.otp.findLatestForEmail(email, purpose);
    if (
      latest &&
      !latest.usedAt &&
      Date.now() - latest.lastSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new AppError(
        'RATE_LIMITED',
        'Please wait a moment before requesting another code.',
      );
    }
  }

  private async issueOtp(
    email: string,
    purpose: OtpPurpose,
    send: (otp: string) => Promise<{ messageId: string }>,
  ): Promise<void> {
    await this.assertResendCooldown(email, purpose);

    const otp = generateOtp(6);
    await this.repos.otp.invalidateAllForEmail(email, purpose);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const [token] = await this.repos.otp.insert({
      email,
      otpHash: hashOtp(otp, this.env.JWT_SECRET),
      purpose,
      expiresAt,
    });
    if (!token) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create verification code.');
    }

    await send(otp);
  }

  private async issuePasswordResetCode(email: string): Promise<void> {
    const now = Date.now();
    const lastSent = this.passwordResetCooldowns.get(email) ?? 0;

    const [latestToken] = await this.repos.otp.findLatestForEmail(email, 'PASSWORD_RESET');
    const lastTokenSent =
      latestToken && !latestToken.usedAt ? latestToken.lastSentAt.getTime() : 0;
    const effectiveLastSent = Math.max(lastSent, lastTokenSent);

    if (now - effectiveLastSent < RESEND_COOLDOWN_MS) {
      throw new AppError(
        'RATE_LIMITED',
        'Please wait a moment before requesting another code.',
      );
    }
    this.passwordResetCooldowns.set(email, now);

    const [user] = await this.repos.auth.findUserByEmail(email);
    if (!user || !user.active) {
      return;
    }

    const otp = generateOtp(6);
    await this.repos.otp.invalidateAllForEmail(email, 'PASSWORD_RESET');
    const expiresAt = new Date(now + OTP_TTL_MS);
    const [token] = await this.repos.otp.insert({
      email,
      otpHash: hashOtp(otp, this.env.JWT_SECRET),
      purpose: 'PASSWORD_RESET',
      expiresAt,
    });
    if (!token) {
      throw new AppError('INTERNAL_ERROR', 'Failed to create verification code.');
    }

    await this.emailService.sendPasswordResetCode(email, otp);
  }

  private async verifyOtpToken(
    token: { id: string; otpHash: string; attempts: number; expiresAt: Date; usedAt: Date | null }
      | undefined,
    otp: string,
    options: { consumeOnSuccess: boolean },
  ): Promise<void> {
    if (!token || token.usedAt) {
      throw new AppError('VALIDATION_ERROR', 'Invalid verification code.');
    }

    if (token.expiresAt.getTime() < Date.now()) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This verification code has expired. Please request a new code.',
      );
    }

    if (token.attempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    if (!verifyOtp(otp, token.otpHash, this.env.JWT_SECRET)) {
      const [updated] = await this.repos.otp.incrementAttempts(token.id);
      if (updated && updated.attempts >= MAX_OTP_ATTEMPTS) {
        await this.repos.otp.markUsed(token.id);
      }
      throw new AppError('VALIDATION_ERROR', 'Invalid verification code. Please try again.');
    }

    if (options.consumeOnSuccess) {
      await this.repos.otp.markVerified(token.id);
    } else {
      await this.repos.otp.markVerifiedOnly(token.id);
    }
  }

  createAccessToken(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        sub: userId,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      }),
    ).toString('base64url');
    const signature = createHash('sha256')
      .update(`${payload}.${this.env.JWT_SECRET}`)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyAccessToken(token: string): string {
    const [payloadPart, signaturePart] = token.split('.');
    if (!payloadPart || !signaturePart) {
      throw new AppError('UNAUTHORIZED', 'Invalid access token.');
    }

    const expectedSignature = createHash('sha256')
      .update(`${payloadPart}.${this.env.JWT_SECRET}`)
      .digest('base64url');

    const actual = Buffer.from(signaturePart);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AppError('UNAUTHORIZED', 'Invalid access token.');
    }

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as {
      sub?: string;
      exp?: number;
    };

    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AppError('UNAUTHORIZED', 'Access token expired.');
    }

    return payload.sub;
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(`${otp}.${this.env.JWT_SECRET}`).digest('hex');
  }

  private verifyOtpHash(otp: string, hash: string): boolean {
    const actual = Buffer.from(this.hashOtp(otp));
    const expected = Buffer.from(hash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
