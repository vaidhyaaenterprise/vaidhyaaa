import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import {
  AppError,
  createDoctorServiceMappingSchema,
  createClinicHolidaySchema,
  patchClinicHolidaySchema,
  replaceClinicHoursSchema,
  replaceDoctorSchedulesSchema,
  type AuthContext,
  updateBookingRuleSchema,
  updateDoctorServiceMappingSchema,
} from '@vaidya/shared';
import { z } from 'zod';

import { ClinicAdmin } from '../../common/decorators/platform-admin.decorator';
import { ClinicScoped } from '../../common/decorators/clinic-scoped.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';

import { ClinicClinicalService } from './clinic-clinical.service';
import { DoctorHistoryService } from './doctor-history.service';

const createClinicServiceSchema = z.object({
  service_name: z.string().min(1),
  service_key: z.string().optional(),
  active: z.boolean().optional(),
});

@Controller('clinics/:clinicId')
@ClinicScoped()
export class ClinicClinicalController {
  constructor(
    @Inject(ClinicClinicalService) private readonly clinicalService: ClinicClinicalService,
    @Inject(DoctorHistoryService) private readonly doctorHistoryService: DoctorHistoryService,
  ) {}

  @Get('doctors')
  @Roles('clinic_admin', 'doctor')
  async listDoctors(@Param('clinicId') clinicId: string) {
    const doctors = await this.clinicalService.listDoctors(clinicId);
    return { doctors };
  }

  @Get('services')
  @Roles('clinic_admin', 'doctor')
  async listServices(@Param('clinicId') clinicId: string) {
    const services = await this.clinicalService.listServices(clinicId);
    return { services };
  }

@Patch('services/:serviceId')
  @ClinicAdmin()
  async patchService(
    @Param('clinicId') clinicId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: { service_name?: string; active?: boolean },
  ) {
    const service = await this.clinicalService.patchClinicService(clinicId, serviceId, body);
    return { service };
  }

  @Delete('doctors/:doctorId')
  @ClinicAdmin()
  async deleteDoctor(@Param('clinicId') clinicId: string, @Param('doctorId') doctorId: string) {
    const result = await this.clinicalService.deleteDoctor(clinicId, doctorId);
    return result;
  }

  @Delete('services/:serviceId')
  @ClinicAdmin()
  async deleteService(@Param('clinicId') clinicId: string, @Param('serviceId') serviceId: string) {
    const result = await this.clinicalService.deleteClinicService(clinicId, serviceId);
    return result;
  }

  @Delete('doctor-services/:mappingId')
  @ClinicAdmin()
  async deleteDoctorServiceMapping(
    @Param('clinicId') clinicId: string,
    @Param('mappingId') mappingId: string,
  ) {
    const result = await this.clinicalService.deleteDoctorServiceMapping(clinicId, mappingId);
    return result;
  }

  @Post('services')
  @ClinicAdmin()
  async createService(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = createClinicServiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid service payload.');
    }
    const service = await this.clinicalService.createClinicService(clinicId, {
      service_name: parsed.data.service_name,
      ...(parsed.data.service_key !== undefined ? { service_key: parsed.data.service_key } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    });
    return { service };
  }

  @Get('doctor-services')
  @Roles('clinic_admin', 'doctor')
  async listDoctorServices(@Param('clinicId') clinicId: string) {
    const mappings = await this.clinicalService.listDoctorServiceMappings(clinicId);
    return { doctor_services: mappings };
  }

  @Patch('doctor-services/:mappingId')
  @ClinicAdmin()
  async patchDoctorService(
    @Param('clinicId') clinicId: string,
    @Param('mappingId') mappingId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateDoctorServiceMappingSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor-service mapping payload.');
    }
    const mapping = await this.clinicalService.patchDoctorServiceMapping(
      clinicId,
      mappingId,
      parsed.data,
    );
    return { doctor_service: mapping };
  }

  @Post('doctor-services')
  @ClinicAdmin()
  async createDoctorService(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = createDoctorServiceMappingSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor-service mapping payload.');
    }
    const mapping = await this.clinicalService.createDoctorServiceMapping(clinicId, parsed.data);
    return { doctor_service: mapping };
  }

  @Get('booking-rules')
  @Roles('clinic_admin', 'doctor')
  async listBookingRules(@Param('clinicId') clinicId: string) {
    const booking_rules = await this.clinicalService.listBookingRules(clinicId);
    return { booking_rules };
  }

  @Patch('booking-rules/:ruleId')
  @ClinicAdmin()
  async patchBookingRule(
    @Param('clinicId') clinicId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateBookingRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid booking rule payload.');
    }
    const booking_rule = await this.clinicalService.patchBookingRule(clinicId, ruleId, parsed.data);
    return { booking_rule };
  }

  @Post('booking-rules/:ruleId/preview')
  @ClinicAdmin()
  async previewBookingRuleChange(
    @Param('clinicId') clinicId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateBookingRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid booking rule preview payload.');
    }
    const previewPatch: { capacity_per_slot?: number; slot_duration_minutes?: number } = {};
    if (parsed.data.capacity_per_slot !== undefined) {
      previewPatch.capacity_per_slot = parsed.data.capacity_per_slot;
    }
    if (parsed.data.slot_duration_minutes !== undefined) {
      previewPatch.slot_duration_minutes = parsed.data.slot_duration_minutes;
    }
    const preview = await this.clinicalService.previewBookingRuleChange(
      clinicId,
      ruleId,
      previewPatch,
    );
    return { preview };
  }

  @Get('hours')
  @Roles('clinic_admin', 'doctor')
  async listHours(@Param('clinicId') clinicId: string) {
    const hours = await this.clinicalService.listClinicHours(clinicId);
    return { hours };
  }

  @Put('hours')
  @ClinicAdmin()
  async replaceHours(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = replaceClinicHoursSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic hours payload.');
    }
    const hours = await this.clinicalService.replaceClinicHours(clinicId, parsed.data);
    return { hours };
  }

  @Post('hours/preview')
  @ClinicAdmin()
  async previewHours(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = replaceClinicHoursSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid clinic hours preview payload.');
    }
    const preview = await this.clinicalService.previewClinicHoursReplace(clinicId, parsed.data);
    return { preview };
  }

  @Get('holidays')
  @Roles('clinic_admin', 'doctor')
  async listHolidays(@Param('clinicId') clinicId: string) {
    const holidays = await this.clinicalService.listHolidays(clinicId);
    return { holidays };
  }

  @Post('holidays')
  @ClinicAdmin()
  async createHoliday(
    @Param('clinicId') clinicId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const parsed = createClinicHolidaySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid holiday payload.');
    }
    const auth = getAuthContext(request);
    const holiday = await this.clinicalService.createHoliday(clinicId, parsed.data, auth.userId);
    return { holiday };
  }

  @Post('holidays/preview')
  @ClinicAdmin()
  async previewHoliday(@Param('clinicId') clinicId: string, @Body() body: unknown) {
    const parsed = createClinicHolidaySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid holiday preview payload.');
    }
    const preview = await this.clinicalService.previewHolidayDate(
      clinicId,
      parsed.data.holiday_date,
      parsed.data.doctor_ids,
    );
    return { preview };
  }

  @Patch('holidays/:holidayId')
  @ClinicAdmin()
  async patchHoliday(
    @Param('clinicId') clinicId: string,
    @Param('holidayId') holidayId: string,
    @Body() body: unknown,
  ) {
    const parsed = patchClinicHolidaySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid holiday update payload.');
    }
    const holiday = await this.clinicalService.patchHoliday(clinicId, holidayId, parsed.data);
    return { holiday };
  }

  @Get('doctors/:doctorId/schedules')
  @Roles('clinic_admin', 'doctor')
  async listDoctorSchedules(
    @Param('clinicId') clinicId: string,
    @Param('doctorId') doctorId: string,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    if (auth.clinicRole === 'doctor' && auth.doctorId && auth.doctorId !== doctorId) {
      throw new AppError('FORBIDDEN', 'Doctors may only view their own schedule.');
    }
    const schedules = await this.clinicalService.listDoctorSchedules(clinicId, doctorId);
    return { schedules };
  }

  @Get('patients/history')
  @Roles('clinic_admin', 'doctor')
  async searchPatientHistory(
    @Param('clinicId') clinicId: string,
    @Query('phone') phone?: string,
    @Query('name') name?: string,
    @Query('age') age?: string,
  ) {
    let parsedAge: number | undefined;
    if (age !== undefined && age.trim().length > 0) {
      parsedAge = Number.parseInt(age.trim(), 10);
      if (Number.isNaN(parsedAge)) {
        throw new AppError('VALIDATION_ERROR', 'Age must be a valid integer.');
      }
    }

    const result = await this.doctorHistoryService.searchPatientHistory(clinicId, {
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(parsedAge !== undefined ? { age: parsedAge } : {}),
    });

    return { patients: result.patients };
  }

  @Put('doctors/:doctorId/schedules')
  @Roles('clinic_admin', 'doctor')
  async replaceDoctorSchedules(
    @Param('clinicId') clinicId: string,
    @Param('doctorId') doctorId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    if (auth.clinicRole === 'doctor' && auth.doctorId && auth.doctorId !== doctorId) {
      throw new AppError('FORBIDDEN', 'Doctors may only edit their own schedule.');
    }
    const parsed = replaceDoctorSchedulesSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid doctor schedule payload.');
    }
    const schedules = await this.clinicalService.replaceDoctorSchedules(
      clinicId,
      doctorId,
      parsed.data,
    );
    return { schedules };
  }

  @Get('calls')
  @ClinicAdmin()
  async listCalls(
    @Param('clinicId') clinicId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const calls = await this.clinicalService.listCalls(clinicId, from, to);
    return { calls };
  }

  @Get('calls/:callId')
  @ClinicAdmin()
  async getCall(@Param('clinicId') clinicId: string, @Param('callId') callId: string) {
    const call = await this.clinicalService.getCall(clinicId, callId);
    return { call };
  }

  @Get('callback-requests')
  @ClinicAdmin()
  async listCallbackRequests(
    @Param('clinicId') clinicId: string,
    @Query('status') status?: string,
  ) {
    const callbackRequests = await this.clinicalService.listCallbackRequests(clinicId, status);
    return { callback_requests: callbackRequests };
  }

  @Get('notifications')
  @ClinicAdmin()
  async listNotifications(@Param('clinicId') clinicId: string) {
    const notifications = await this.clinicalService.listClinicNotifications(clinicId);
    return { notifications };
  }
}
