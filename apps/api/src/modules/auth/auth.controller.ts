import { Body, Controller, Post, Inject } from '@nestjs/common';

import { AppError } from '@vaidya/shared';

import { Public } from '../../common/decorators/public.decorator';
import {
  forgotPasswordSchema,
  loginWithUsernamePasswordSchema,
  registerClinicAdminSchema,
  requestOtpSchema,
  resendPasswordResetCodeSchema,
  resendVerificationCodeSchema,
  resetPasswordSchema,
  sendVerificationCodeSchema,
  verifyEmailSchema,
  verifyOtpSchema,
  verifyPasswordResetCodeSchema,
} from '../platform/platform.schemas';

import { AuthService } from './auth.service';
import { ClinicRegistrationService } from './clinic-registration.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ClinicRegistrationService)
    private readonly clinicRegistrationService: ClinicRegistrationService,
  ) {}

  @Public()
  @Post('register')
  async registerClinic(@Body() body: unknown) {
    const parsed = registerClinicAdminSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic registration payload.');
    }

    return this.clinicRegistrationService.register(parsed.data);
  }

  @Public()
  @Post('login')
  async loginWithUsernamePassword(@Body() body: unknown) {
    const parsed = loginWithUsernamePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid login payload.');
    }

    return this.authService.loginWithUsernamePassword(
      parsed.data.username,
      parsed.data.password,
    );
  }

  @Public()
  @Post('request-otp')
  async requestOtp(@Body() body: unknown) {
    const parsed = requestOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid OTP request payload.');
    }

    return this.authService.requestOtp(parsed.data.identifier);
  }

  @Public()
  @Post('verify-otp')
  async verifyOtp(@Body() body: unknown) {
    const parsed = verifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid OTP verification payload.');
    }

    return this.authService.verifyOtp(parsed.data);
  }

  @Public()
  @Post('send-verification-code')
  async sendVerificationCode(@Body() body: unknown) {
    const parsed = sendVerificationCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.');
    }

    return this.authService.sendVerificationCode(parsed.data);
  }

  @Public()
  @Post('resend-verification-code')
  async resendVerificationCode(@Body() body: unknown) {
    const parsed = resendVerificationCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.');
    }

    return this.authService.resendVerificationCode(parsed.data);
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() body: unknown) {
    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter your email and 6-digit verification code.');
    }

    return this.authService.verifyEmail(parsed.data);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() body: unknown) {
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.');
    }

    return this.authService.forgotPassword(parsed.data);
  }

  @Public()
  @Post('resend-password-reset-code')
  async resendPasswordResetCode(@Body() body: unknown) {
    const parsed = resendPasswordResetCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.');
    }

    return this.authService.resendPasswordResetCode(parsed.data);
  }

  @Public()
  @Post('verify-password-reset-code')
  async verifyPasswordResetCode(@Body() body: unknown) {
    const parsed = verifyPasswordResetCodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter your email and 6-digit verification code.');
    }

    return this.authService.verifyPasswordResetCode(parsed.data);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() body: unknown) {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Enter your email, code, and a new password.');
    }

    return this.authService.resetPassword(parsed.data);
  }

  @Post('logout')
  logout() {
    return { ok: true };
  }
}
