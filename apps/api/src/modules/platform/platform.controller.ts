import { Body, Controller, Get, Param, Post, Req, UseGuards, Inject } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { AppError, type AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';
import { PlatformAdminGuard } from '../../common/guards/role.guards';

import {
  createPlatformClinicSchema,
  disableUserSchema,
  inviteClinicAdminSchema,
  parseCreatePlatformClinicBody,
} from './platform.schemas';
import { PlatformOnboardingService } from './platform-onboarding.service';

@Controller('internal/platform/clinics')
@UseGuards(PlatformAdminGuard)
export class PlatformClinicsController {
  constructor(
    @Inject(PlatformOnboardingService)
    private readonly platformService: PlatformOnboardingService,
  ) {}

  @Post()
  async createClinic(
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = createPlatformClinicSchema.safeParse(body);
    let input;
    if (parsed.success) {
      input = parsed.data;
    } else {
      try {
        input = parseCreatePlatformClinicBody(body);
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid clinic payload.', {
          fields: parsed.error.issues,
        });
      }
    }

    const auth = getAuthContext(request);
    const result = await this.platformService.createClinic(input, auth.userId);
    return {
      clinic: {
        id: result.clinic.id,
        name: result.clinic.name,
        onboarding_status: result.clinic.onboardingStatus,
        active: result.clinic.active,
      },
      admin_user: {
        id: result.admin_user.id,
        name: result.admin_user.name,
        email: result.admin_user.email,
        phone: result.admin_user.phone,
      },
    };
  }

  @Get()
  async listClinics() {
    const clinics = await this.platformService.listClinics();
    return {
      clinics: clinics.map((clinic) => ({
        id: clinic.id,
        name: clinic.name,
        active: clinic.active,
        onboarding_status: clinic.onboardingStatus,
      })),
    };
  }

  @Get(':clinicId/onboarding')
  async getOnboarding(@Param('clinicId') clinicId: string) {
    const onboarding = await this.platformService.getOnboarding(clinicId);
    return {
      clinic: onboarding.clinic,
      settings: onboarding.settings
        ? {
            agent_enabled: onboarding.settings.agentEnabled,
            answering_mode: onboarding.settings.answeringMode,
            booking_mode: onboarding.settings.bookingMode,
          }
        : null,
      checklist: onboarding.checklist,
      languages: onboarding.languages,
      subscription: onboarding.subscription,
    };
  }

  @Post(':clinicId/admins/invite')
  async inviteAdmin(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = inviteClinicAdminSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid invite payload.');
    }

    const auth = getAuthContext(request);
    const user = await this.platformService.inviteClinicAdmin(clinicId, parsed.data, auth.userId);
    return { user };
  }

  @Post(':clinicId/suspend')
  async suspendClinic(
    @Param('clinicId') clinicId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const clinic = await this.platformService.setClinicActive(clinicId, false, auth.userId);
    return { clinic };
  }

  @Post(':clinicId/activate')
  async activateClinic(
    @Param('clinicId') clinicId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const clinic = await this.platformService.setClinicActive(clinicId, true, auth.userId);
    return { clinic };
  }
}

@Controller('internal/platform/users')
@UseGuards(PlatformAdminGuard)
export class PlatformUsersController {
  constructor(
    @Inject(PlatformOnboardingService)
    private readonly platformService: PlatformOnboardingService,
  ) {}

  @Post(':userId/disable')
  async disableUser(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = disableUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid disable payload.');
    }

    const auth = getAuthContext(request);
    const user = await this.platformService.setUserActive(userId, parsed.data.active, auth.userId);
    return { user };
  }
}
