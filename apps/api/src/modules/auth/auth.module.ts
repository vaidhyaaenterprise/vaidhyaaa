import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClinicRegistrationService } from './clinic-registration.service';
import { MeController } from './me.controller';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [AuthController, MeController],
  providers: [AuthService, ClinicRegistrationService],
  exports: [AuthService],
})
export class AuthModule {}
