import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Reflector } from '@nestjs/core';

import { type ApiEnv } from '@vaidya/config';

import { AdaptersModule } from './common/adapters/adapters.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { RbacGuard } from './common/guards/rbac.guard';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { AppLogger } from './common/logger/logger.service';
import { LoggerModule } from './common/logger/logger.module';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { ApiConfigModule, API_ENV } from './config/api-config.module';
import { AuthService } from './modules/auth/auth.service';
import { DatabaseModule } from './modules/database/database.module';
import { PlatformModule } from './modules/platform/platform.module';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CallInboxModule } from './modules/call-inbox/call-inbox.module';
import { ClinicSetupModule } from './modules/clinic-setup/clinic-setup.module';
import { ClinicsModule } from './modules/clinics/clinics.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SlotsModule } from './modules/slots/slots.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { LanguageVariationModule } from './modules/language-variation/language-variation.module';
import { NluReviewModule } from './modules/nlu-review/nlu-review.module';
import { NotificationModule } from './modules/notification/notification.module';
import { SarvamToolsModule } from './modules/sarvam-tools/sarvam-tools.module';
import { VoiceModule } from './modules/voice/voice.module';

@Module({
  imports: [
    ApiConfigModule,
    SarvamToolsModule,
    LoggerModule,
    AdaptersModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    PlatformModule,
    ClinicsModule,
    ClinicSetupModule,
    DoctorsModule,
    AppointmentModule,
    ConversationModule,
    KnowledgeModule,
    LanguageVariationModule,
    NluReviewModule,
    CallInboxModule,
    NotificationModule,
    VoiceModule,
    AuditModule,
    JobsModule,
    SlotsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (logger: AppLogger) => new AllExceptionsFilter(logger),
      inject: [AppLogger],
    },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector, env: ApiEnv, authService: AuthService) =>
        new AuthGuard(reflector, env, authService),
      inject: [Reflector, API_ENV, AuthService],
    },
    {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) => new RbacGuard(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_PIPE,
      useFactory: (reflector: Reflector) => new ZodValidationPipe(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (env: ApiEnv, reflector: Reflector) => new ApiResponseInterceptor(env, reflector),
      inject: [API_ENV, Reflector],
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, IdempotencyMiddleware).forRoutes('*');
  }
}
