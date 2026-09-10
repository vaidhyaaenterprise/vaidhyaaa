import { APPOINTMENT_STATUSES } from '@vaidya/shared/enums';
import { clinicSettingsPatchSchema } from '@vaidya/shared/dto';

/** Web-side smoke import to ensure subpath exports work without circular deps. */
export function isPendingConfirmationStatus(status: string): boolean {
  return (
    APPOINTMENT_STATUSES.includes(status as (typeof APPOINTMENT_STATUSES)[number]) &&
    status === 'pending_confirmation'
  );
}

export function parseClinicSettingsPatch(input: unknown) {
  return clinicSettingsPatchSchema.safeParse(input);
}
