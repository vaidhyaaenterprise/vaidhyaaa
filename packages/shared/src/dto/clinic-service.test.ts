import { describe, expect, it } from 'vitest';

import { PREDEFINED_CLINIC_SERVICES, findPredefinedClinicService } from './clinic-service';

describe('predefined clinic services', () => {
  it('provides the exact supported service keys with readable stored names', () => {
    expect(PREDEFINED_CLINIC_SERVICES).toEqual([
      {
        service_key: 'orthopaedic_consultation',
        service_name: 'Orthopaedic Consultation',
      },
      {
        service_key: 'paediatric_consultation',
        service_name: 'Paediatric Consultation',
      },
      {
        service_key: 'general_consultation',
        service_name: 'General Consultation',
      },
      {
        service_key: 'dermatology_consultation',
        service_name: 'Dermatology Consultation',
      },
      { service_key: 'ent_consultation', service_name: 'ENT Consultation' },
      { service_key: 'dental_consultation', service_name: 'Dental Consultation' },
      {
        service_key: 'cardiology_consultation',
        service_name: 'Cardiology Consultation',
      },
      {
        service_key: 'ophthalmology_consultation',
        service_name: 'Ophthalmology Consultation',
      },
      {
        service_key: 'gynaecology_consultation',
        service_name: 'Gynaecology Consultation',
      },
      { service_key: 'neurology_consultation', service_name: 'Neurology Consultation' },
      {
        service_key: 'gastroenterology_consultation',
        service_name: 'Gastroenterology Consultation',
      },
    ]);

    expect(
      PREDEFINED_CLINIC_SERVICES.every(
        (service) =>
          !service.service_name.includes('_') && /^[A-Z]/.test(service.service_name),
      ),
    ).toBe(true);
  });

  it('looks up a canonical service by its stored key', () => {
    expect(findPredefinedClinicService('ent_consultation')).toEqual({
      service_key: 'ent_consultation',
      service_name: 'ENT Consultation',
    });
    expect(findPredefinedClinicService('custom_service')).toBeUndefined();
  });
});
