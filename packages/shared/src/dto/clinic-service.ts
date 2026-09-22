export const PREDEFINED_CLINIC_SERVICES = [
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
  {
    service_key: 'ent_consultation',
    service_name: 'ENT Consultation',
  },
  {
    service_key: 'dental_consultation',
    service_name: 'Dental Consultation',
  },
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
  {
    service_key: 'neurology_consultation',
    service_name: 'Neurology Consultation',
  },
  {
    service_key: 'gastroenterology_consultation',
    service_name: 'Gastroenterology Consultation',
  },
] as const;

export type PredefinedClinicService = (typeof PREDEFINED_CLINIC_SERVICES)[number];
export type PredefinedClinicServiceKey = PredefinedClinicService['service_key'];

export function findPredefinedClinicService(
  serviceKey: string,
): PredefinedClinicService | undefined {
  return PREDEFINED_CLINIC_SERVICES.find((service) => service.service_key === serviceKey);
}
