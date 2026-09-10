import { SetMetadata } from '@nestjs/common';

export const DOCTOR_OWNED_KEY = 'doctorOwned';
export const DoctorOwned = () => SetMetadata(DOCTOR_OWNED_KEY, true);
