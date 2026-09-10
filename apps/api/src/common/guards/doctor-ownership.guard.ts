import { CanActivate, ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { AppError } from '@vaidya/shared';

import { AppointmentsService } from '../../modules/appointment/appointments.service';
import { AUTH_CONTEXT_KEY } from './auth.guard';

@Injectable()
export class DoctorOwnershipGuard implements CanActivate {
  constructor(@Inject(AppointmentsService) private readonly appointmentsService: AppointmentsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      FastifyRequest & {
        [AUTH_CONTEXT_KEY]?: {
          clinicRole?: string;
          doctorId?: string;
          platformRole?: string;
        };
        params?: { clinicId?: string; appointmentId?: string };
      }
    >();

    const auth = request[AUTH_CONTEXT_KEY];
    if (!auth) {
      throw new AppError('UNAUTHORIZED', 'Authentication is required.');
    }

    if (auth.platformRole === 'platform_admin' || auth.clinicRole === 'clinic_admin') {
      return true;
    }

    if (auth.clinicRole !== 'doctor' || !auth.doctorId) {
      throw new AppError('DOCTOR_NOT_OWNER', 'Doctor profile is not linked to this account.');
    }

    const clinicId = request.params?.clinicId;
    const appointmentId = request.params?.appointmentId;
    if (!clinicId || !appointmentId) {
      throw new AppError('VALIDATION_ERROR', 'Clinic and appointment identifiers are required.');
    }

    const appointment = await this.appointmentsService.getAppointment(clinicId, appointmentId);

    if (appointment.doctorId !== auth.doctorId) {
      throw new AppError('DOCTOR_NOT_OWNER', 'Doctor can only access their own appointments.');
    }

    return true;
  }
}
