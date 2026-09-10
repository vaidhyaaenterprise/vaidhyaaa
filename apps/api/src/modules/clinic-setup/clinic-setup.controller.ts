import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import {
  AppError,
  clinicSettingsPatchSchema,
  type AuthContext,
} from '@vaidya/shared';

import { DEV_AUTH_HEADERS } from '../../common/constants/auth.constants';
import { deriveLoginNumber } from '../../common/crypto/password';
import { ClinicAdmin } from '../../common/decorators/platform-admin.decorator';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';
import { inviteClinicUserSchema, createClinicUserLoginSchema } from '../platform/platform.schemas';

import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicUsersService } from './clinic-users.service';

function mapSettingsResponse(settings: {
  clinicId: string;
  agentEnabled: boolean;
  answeringMode: string;
  fallbackPhone: string | null;
  overflowAfterRings: number | null;
  bookingMode: string;
  maxConcurrentCalls: number;
  recordingRetentionDays: number;
  transcriptRetentionDays: number;
  notifyStaffOnPendingAppointment: boolean;
  pendingAppointmentNotificationChannel: string | null;
  allowDoctorServiceEdit: boolean;
  allowPatientAutoCancel: boolean;
}) {
  return {
    clinic_id: settings.clinicId,
    agent_enabled: settings.agentEnabled,
    answering_mode: settings.answeringMode,
    fallback_phone: settings.fallbackPhone,
    overflow_after_rings: settings.overflowAfterRings,
    booking_mode: settings.bookingMode,
    max_concurrent_calls: settings.maxConcurrentCalls,
    recording_retention_days: settings.recordingRetentionDays,
    transcript_retention_days: settings.transcriptRetentionDays,
    notify_staff_on_pending_appointment: settings.notifyStaffOnPendingAppointment,
    pending_appointment_notification_channel: settings.pendingAppointmentNotificationChannel,
    allow_doctor_service_edit: settings.allowDoctorServiceEdit,
    allow_patient_auto_cancel: settings.allowPatientAutoCancel,
  };
}

function mapClinicUserRows(
  rows: Awaited<ReturnType<ClinicUsersService['listUsers']>>['users'],
) {
  return rows.map((row) => ({
    id: row.membership.id,
    clinic_id: row.membership.clinicId,
    user_id: row.membership.userId,
    role: row.membership.role,
    doctor_id: row.membership.doctorId,
    active: row.membership.active,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
      username: row.user.username ?? null,
      active: row.user.active,
    },
  }));
}

function resolveClinicIdFromLegacyRequest(
  request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
): string {
  const auth = getAuthContext(request);
  const headerClinicId = request.headers[DEV_AUTH_HEADERS.CLINIC_ID];
  if (typeof headerClinicId === 'string' && headerClinicId.length > 0) {
    return headerClinicId;
  }
  if (auth.clinicId) {
    return auth.clinicId;
  }
  throw new AppError('FORBIDDEN', 'Clinic context is required.');
}

@Controller('clinics/:clinicId/profile')
@ClinicScoped()
export class ClinicProfileController {
  constructor(@Inject(ClinicSettingsService) private readonly settingsService: ClinicSettingsService) {}

  @Get()
  async getProfile(@Param('clinicId') clinicId: string) {
    const profile = await this.settingsService.getClinicProfile(clinicId);
    return {
      clinic: {
        name: profile.name,
        clinic_unique_number: profile.uniqueNumber,
        primary_phone: profile.primaryPhone,
        address_line1: profile.addressLine1,
        address_line2: profile.addressLine2,
        city: profile.city,
        state: profile.state,
        postal_code: profile.postalCode,
        country: profile.country,
        timezone: profile.timezone,
      },
    };
  }
}

@Controller('clinics/:clinicId/settings')
@ClinicScoped()
export class ClinicSettingsController {
  constructor(@Inject(ClinicSettingsService) private readonly settingsService: ClinicSettingsService) {}

  @Get()
  @ClinicAdmin()
  async getSettings(@Param('clinicId') clinicId: string) {
    const settings = await this.settingsService.getSettings(clinicId);
    return { settings: mapSettingsResponse(settings) };
  }

  @Patch()
  @ClinicAdmin()
  async patchSettings(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = clinicSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic settings payload.', {
        fields: parsed.error.issues,
      });
    }

    const auth = getAuthContext(request);
    const settings = await this.settingsService.patchSettings(
      clinicId,
      parsed.data,
      auth.userId,
    );
    return { settings: mapSettingsResponse(settings) };
  }
}

@Controller('clinics/:clinicId/users')
@ClinicScoped()
export class ClinicUsersController {
  constructor(@Inject(ClinicUsersService) private readonly clinicUsersService: ClinicUsersService) {}

  @Get()
  @ClinicAdmin()
  async listUsers(@Param('clinicId') clinicId: string) {
    const result = await this.clinicUsersService.listUsers(clinicId);
    return {
      users: mapClinicUserRows(result.users),
      clinic_login_number: result.clinicLoginNumber ?? deriveLoginNumber(clinicId),
    };
  }

  @Post('invite')
  @ClinicAdmin()
  async inviteUser(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = inviteClinicUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic user invite payload.');
    }

    const auth = getAuthContext(request);
    const result = await this.clinicUsersService.inviteUser(clinicId, parsed.data, auth.userId);
    return {
      user: result.user,
      membership: result.membership,
    };
  }

  @Post()
  @ClinicAdmin()
  async createLogin(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = createClinicUserLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic user login payload.');
    }

    const auth = getAuthContext(request);
    const result = await this.clinicUsersService.createLogin(clinicId, parsed.data, auth.userId);
    return {
      user: {
        id: result.user.id,
        name: result.user.name,
        username: result.user.username,
        active: result.user.active,
      },
      membership: result.membership,
    };
  }

  @Post(':clinicUserId/disable')
  @ClinicAdmin()
  async disableUser(
    @Param('clinicId') clinicId: string,
    @Param('clinicUserId') clinicUserId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const membership = await this.clinicUsersService.setMembershipActive(
      clinicId,
      clinicUserId,
      false,
      auth.userId,
    );
    return { membership };
  }

  @Post(':clinicUserId/enable')
  @ClinicAdmin()
  async enableUser(
    @Param('clinicId') clinicId: string,
    @Param('clinicUserId') clinicUserId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const membership = await this.clinicUsersService.setMembershipActive(
      clinicId,
      clinicUserId,
      true,
      auth.userId,
    );
    return { membership };
  }
}

/** @deprecated Use `/v1/clinics/:clinicId/users` — kept for backward compatibility. */
@Controller('clinic/users')
@ClinicScoped()
export class ClinicUsersLegacyController {
  constructor(@Inject(ClinicUsersService) private readonly clinicUsersService: ClinicUsersService) {}

  @Get()
  @ClinicAdmin()
  async listUsers(@Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext }) {
    const clinicId = resolveClinicIdFromLegacyRequest(request);
    const result = await this.clinicUsersService.listUsers(clinicId);
    return {
      users: mapClinicUserRows(result.users),
      clinic_login_number: result.clinicLoginNumber ?? deriveLoginNumber(clinicId),
    };
  }

  @Post('invite')
  @ClinicAdmin()
  async inviteUser(
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = inviteClinicUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic user invite payload.');
    }
    const clinicId = resolveClinicIdFromLegacyRequest(request);
    const auth = getAuthContext(request);
    const result = await this.clinicUsersService.inviteUser(clinicId, parsed.data, auth.userId);
    return { user: result.user, membership: result.membership };
  }

  @Post(':clinicUserId/disable')
  @ClinicAdmin()
  async disableUser(
    @Param('clinicUserId') clinicUserId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const clinicId = resolveClinicIdFromLegacyRequest(request);
    const auth = getAuthContext(request);
    const membership = await this.clinicUsersService.setMembershipActive(
      clinicId,
      clinicUserId,
      false,
      auth.userId,
    );
    return { membership };
  }

  @Post(':clinicUserId/enable')
  @ClinicAdmin()
  async enableUser(
    @Param('clinicUserId') clinicUserId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const clinicId = resolveClinicIdFromLegacyRequest(request);
    const auth = getAuthContext(request);
    const membership = await this.clinicUsersService.setMembershipActive(
      clinicId,
      clinicUserId,
      true,
      auth.userId,
    );
    return { membership };
  }
}
