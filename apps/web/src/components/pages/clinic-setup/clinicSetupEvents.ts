export const CLINIC_DOCTOR_DETAILS_UPDATED_EVENT = 'vaidya:clinic-doctor-details-updated';

export function notifyClinicDoctorDetailsUpdated(clinicId: string) {
  window.dispatchEvent(
    new CustomEvent(CLINIC_DOCTOR_DETAILS_UPDATED_EVENT, {
      detail: { clinicId },
    }),
  );
}
