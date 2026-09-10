import { Global, Module } from '@nestjs/common';

import { ADAPTER_TOKENS } from '@vaidya/shared';

import { LoggerModule } from '../logger/logger.module';
import { JobInfrastructureModule } from '../jobs/job-infrastructure.module';
import { LanguagePackService } from '../../modules/conversation/language-pack.service';

import {
  LoggingAuditService,
  MockObjectStorageProvider,
  NoOpActionValidator,
} from './mock-adapters';
import {
  ConfigurableMockMessagingProvider,
  MockMessagingProviderAdapter,
} from './mock-messaging.provider';
import {
  createIntentClassifierProvider,
  createReceptionistDialogPlannerProvider,
  createServiceRouterProvider,
  createStateEntityExtractorProvider,
} from './llm-provider.factory';
import { MockVoiceAdapter } from './mock-voice-adapter';
import {
  createSttProvider,
  createTelephonyProvider,
  createTtsProvider,
} from './voice-provider.factory';

@Global()
@Module({
  imports: [LoggerModule, JobInfrastructureModule],
  providers: [
    LanguagePackService,
    { provide: ADAPTER_TOKENS.ObjectStorageProvider, useClass: MockObjectStorageProvider },
    ConfigurableMockMessagingProvider,
    MockMessagingProviderAdapter,
    { provide: ADAPTER_TOKENS.MessagingProvider, useExisting: ConfigurableMockMessagingProvider },
    { provide: ADAPTER_TOKENS.NotificationProvider, useClass: MockMessagingProviderAdapter },
    createTelephonyProvider(),
    createSttProvider(),
    createTtsProvider(),
    { provide: ADAPTER_TOKENS.VoiceAdapter, useClass: MockVoiceAdapter },
    createIntentClassifierProvider(),
    createServiceRouterProvider(),
    createStateEntityExtractorProvider(),
    createReceptionistDialogPlannerProvider(),
    { provide: ADAPTER_TOKENS.ActionValidator, useClass: NoOpActionValidator },
    { provide: ADAPTER_TOKENS.AuditService, useClass: LoggingAuditService },
  ],
  exports: [
    LanguagePackService,
    JobInfrastructureModule,
    ADAPTER_TOKENS.ObjectStorageProvider,
    ADAPTER_TOKENS.MessagingProvider,
    ADAPTER_TOKENS.NotificationProvider,
    ADAPTER_TOKENS.TelephonyProvider,
    ADAPTER_TOKENS.SttProvider,
    ADAPTER_TOKENS.TtsProvider,
    ADAPTER_TOKENS.VoiceAdapter,
    ADAPTER_TOKENS.IntentClassifierAdapter,
    ADAPTER_TOKENS.StateEntityExtractorAdapter,
    ADAPTER_TOKENS.ServiceRouterAdapter,
    ADAPTER_TOKENS.ReceptionistDialogPlannerAdapter,
    ADAPTER_TOKENS.ActionValidator,
    ADAPTER_TOKENS.AuditService,
  ],
})
export class AdaptersModule {}
