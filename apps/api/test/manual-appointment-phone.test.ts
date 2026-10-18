import { describe, expect, it } from 'vitest';
import { manualAppointmentCreateSchema } from '@vaidya/shared';
import { AppointmentAdminService } from '../src/modules/appointment/appointment-admin.service';

describe('manual appointment phone validation', () => {
  it('accepts exactly ten digits with no country code', () => {
    expect(manualAppointmentCreateSchema.shape.patient_phone.parse('9876543210')).toBe('9876543210');
  });

  it.each(['', '87784367', '87784367gh', '98765432101', '+919876543210', '98 76543210', '987654321e'])('rejects invalid phone %j at the API boundary and before database work', async (patient_phone) => {
    expect(manualAppointmentCreateSchema.shape.patient_phone.safeParse(patient_phone).success).toBe(false);
    const service = Object.create(AppointmentAdminService.prototype) as AppointmentAdminService;
    await expect(service.createManualAppointment('clinic-1', {
      patient_phone, patient_name: 'Test', patient_age: 25,
      doctor_id: 'doctor-1', clinic_service_id: 'service-1', reason_for_visit: 'Consultation',
      appointment_start: '2026-10-20T09:00:00Z', appointment_end: '2026-10-20T09:30:00Z',
      is_followup: false, status: 'confirmed',
    }, 'admin-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR', message: 'Enter a 10-digit patient phone number without a country code.',
    });
  });
});
