import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import {
  AppError,
  manualAppointmentCreateSchema,
  markAppointmentVisitedSchema,
  resolveAppointmentActionRequestSchema,
  type AuthContext,
} from '@vaidya/shared';

import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';
import { DoctorOwnershipGuard } from '../../common/guards/doctor-ownership.guard';

import { AppointmentAdminService } from './appointment-admin.service';
import { AppointmentLifecycleService } from './appointment-lifecycle.service';
import { AppointmentsService } from './appointments.service';

@Controller('clinics/:clinicId/appointments')
@ClinicScoped()
export class AppointmentsController {
  constructor(
    @Inject(AppointmentsService) private readonly appointmentsService: AppointmentsService,
    @Inject(AppointmentLifecycleService)
    private readonly appointmentLifecycleService: AppointmentLifecycleService,
    @Inject(AppointmentAdminService) private readonly appointmentAdminService: AppointmentAdminService,
  ) {}

  @Get()
  @Roles('clinic_admin', 'doctor')
  async listAppointments(
    @Param('clinicId') clinicId: string,
    @Query('status') status: string | undefined,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const statuses = status?.split(',').map((value) => value.trim()).filter(Boolean);
    const appointments = await this.appointmentsService.listAppointments({
      clinicId,
      ...(auth.clinicRole === 'doctor' && auth.doctorId ? { doctorId: auth.doctorId } : {}),
      ...(statuses?.length ? { status: statuses } : {}),
    });
    return { appointments };
  }

  @Get('action-requests')
  @Roles('clinic_admin')
  async listActionRequests(@Param('clinicId') clinicId: string) {
    const action_requests = await this.appointmentsService.listActionRequests(clinicId);
    return { action_requests };
  }

  @Get('available-slots')
  @Roles('clinic_admin', 'doctor')
  async listAvailableSlots(
    @Param('clinicId') clinicId: string,
    @Query('doctor_id') doctorId: string | undefined,
    @Query('clinic_service_id') clinicServiceId: string | undefined,
    @Query('date') date: string | undefined,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    if (!doctorId || !clinicServiceId || !date) {
      throw new AppError(
        'VALIDATION_ERROR',
        'doctor_id, clinic_service_id, and date are required query params.',
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new AppError('VALIDATION_ERROR', 'date must be in YYYY-MM-DD format.');
    }

    const auth = getAuthContext(request);
    if (auth.clinicRole === 'doctor' && auth.doctorId && auth.doctorId !== doctorId) {
      throw new AppError('FORBIDDEN', 'Doctors may only fetch slots for themselves.');
    }

    const slots = await this.appointmentsService.listAvailableSlots({
      clinicId,
      doctorId,
      clinicServiceId,
      date,
    });

    return { slots };
  }

  @Post()
  @Roles('clinic_admin')
  async createManualAppointment(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = manualAppointmentCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid manual appointment payload.');
    }
    const auth = getAuthContext(request);
    const appointment = await this.appointmentAdminService.createManualAppointment(
      clinicId,
      parsed.data,
      auth.userId,
    );
    return { appointment };
  }

  @Patch('action-requests/:actionRequestId')
  @Roles('clinic_admin')
  async resolveActionRequest(
    @Param('clinicId') clinicId: string,
    @Param('actionRequestId') actionRequestId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = resolveAppointmentActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid action request resolution payload.');
    }
    const auth = getAuthContext(request);
    return this.appointmentAdminService.resolveActionRequest({
      clinicId,
      actionRequestId,
      body: parsed.data,
      actorUserId: auth.userId,
    });
  }

  @Get(':appointmentId')
  @Roles('clinic_admin', 'doctor')
  @UseGuards(DoctorOwnershipGuard)
  async getAppointment(
    @Param('clinicId') clinicId: string,
    @Param('appointmentId') appointmentId: string,
  ) {
    const appointment = await this.appointmentsService.getAppointment(clinicId, appointmentId);
    return { appointment };
  }

  @Patch(':appointmentId/confirm')
  @Roles('clinic_admin')
  async confirmAppointment(
    @Param('clinicId') clinicId: string,
    @Param('appointmentId') appointmentId: string,
  ) {
    const appointment = await this.appointmentLifecycleService.confirmAppointment({
      clinicId,
      appointmentId,
    });
    return { appointment };
  }

  @Patch(':appointmentId/cancel')
  @Roles('clinic_admin')
  async cancelAppointment(
    @Param('clinicId') clinicId: string,
    @Param('appointmentId') appointmentId: string,
  ) {
    const appointment = await this.appointmentLifecycleService.cancelAppointment({
      clinicId,
      appointmentId,
    });
    return { appointment };
  }

  @Patch(':appointmentId/reschedule')
  @Roles('clinic_admin')
  async rescheduleAppointment(
    @Param('clinicId') clinicId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: { new_slot_id: string },
  ) {
    const appointment = await this.appointmentLifecycleService.rescheduleAppointmentTime({
      clinicId,
      appointmentId,
      newSlotId: body.new_slot_id,
    });
    return { appointment };
  }

  @Patch(':appointmentId/mark-visited')
  @Roles('clinic_admin', 'doctor')
  @UseGuards(DoctorOwnershipGuard)
  async markVisited(
    @Param('clinicId') clinicId: string,
    @Param('appointmentId') appointmentId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = markAppointmentVisitedSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid mark-visited payload.');
    }
    const auth = getAuthContext(request);
    return this.appointmentAdminService.markVisited({
      clinicId,
      appointmentId,
      visitReason: parsed.data.visit_reason,
      ...(parsed.data.examination_notes !== undefined
        ? { examinationNotes: parsed.data.examination_notes }
        : {}),
      ...(parsed.data.diagnosis !== undefined ? { diagnosis: parsed.data.diagnosis } : {}),
      ...(parsed.data.advice !== undefined ? { advice: parsed.data.advice } : {}),
      actorUserId: auth.userId,
      ...(auth.clinicRole === 'clinic_admin' || auth.clinicRole === 'doctor'
        ? { actorClinicRole: auth.clinicRole }
        : {}),
    });
  }
}
