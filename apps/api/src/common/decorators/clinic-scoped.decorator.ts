import { SetMetadata } from '@nestjs/common';

export const CLINIC_SCOPED_KEY = 'clinicScoped';
export const ClinicScoped = () => SetMetadata(CLINIC_SCOPED_KEY, true);
