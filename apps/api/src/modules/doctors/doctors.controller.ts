import { Body, Controller, Param, Patch, Post, Req, Inject } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { AppError, type AuthContext } from '@vaidya/shared';

import { ClinicAdmin } from '../../common/decorators/platform-admin.decorator';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';

import { createDoctorSchema, linkDoctorLoginSchema, updateDoctorSchema, updateMembershipSchema } from '../platform/platform.schemas';
import { DoctorsService } from './doctors.service';

@Controller('clinics/:clinicId/doctors')
@ClinicScoped()
export class DoctorsController {
  constructor(@Inject(DoctorsService) private readonly doctorsService: DoctorsService) {}

  @Post()
  @ClinicAdmin()
  async createDoctor(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = createDoctorSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor payload.');
    }

    const doctor = await this.doctorsService.createDoctor(clinicId, parsed.data);
    return { doctor };
  }

  @Post(':doctorId/link-login')
  @ClinicAdmin()
  async linkDoctorLogin(
    @Param('clinicId') clinicId: string,
    @Param('doctorId') doctorId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = linkDoctorLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor login payload.');
    }

    const auth = getAuthContext(request);
    const result = await this.doctorsService.linkDoctorLogin(
      clinicId,
      doctorId,
      parsed.data,
      auth.userId,
    );
    return result;
  }

  @Patch(':doctorId')
  @ClinicAdmin()
  async updateDoctor(
    @Param('clinicId') clinicId: string,
    @Param('doctorId') doctorId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = updateDoctorSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor update payload.');
    }

    const auth = getAuthContext(request);
    const doctor = await this.doctorsService.updateDoctor(
      clinicId,
      doctorId,
      parsed.data,
      auth.userId,
    );
    return { doctor };
  }
}

@Controller('clinics/:clinicId/members')
@ClinicScoped()
export class ClinicMembersController {
  constructor(@Inject(DoctorsService) private readonly doctorsService: DoctorsService) {}

  @Patch(':membershipId')
  @ClinicAdmin()
  async updateMembership(
    @Param('clinicId') clinicId: string,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = updateMembershipSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid membership payload.');
    }

    const auth = getAuthContext(request);
    const membership = await this.doctorsService.updateMembership(
      clinicId,
      membershipId,
      parsed.data.active,
      auth.userId,
    );
    return { membership };
  }
}
