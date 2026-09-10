import { Inject, Injectable } from '@nestjs/common';

import {
  type ActionValidationContext,
  type ActionValidator,
  type AuditLogInput,
  type AuditService,
  type NotificationProvider,
  type NotificationSendInput,
  type ObjectStorageProvider,
  type ObjectStoragePutInput,
  type SttProvider,
  type SttTranscribeInput,
  type TelephonyProvider,
  type TtsProvider,
  type TtsSynthesizeInput,
} from '@vaidya/shared';

import { AppLogger } from '../logger/logger.service';

@Injectable()
export class MockObjectStorageProvider implements ObjectStorageProvider {
  async put(input: ObjectStoragePutInput): Promise<{ key: string }> {
    return { key: input.key };
  }

  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    return `https://mock-storage.local/${key}`;
  }

  async delete(_key: string): Promise<void> {
    return;
  }
}

@Injectable()
export class MockNotificationProvider implements NotificationProvider {
  async send(_input: NotificationSendInput): Promise<{ providerMessageId: string }> {
    return { providerMessageId: 'mock_notification_id' };
  }
}

@Injectable()
export class MockTelephonyProvider implements TelephonyProvider {
  async forwardCall(_callId: string, _destination: string): Promise<void> {
    return;
  }
}

@Injectable()
export class MockSttProvider implements SttProvider {
  async transcribe(_input: SttTranscribeInput): Promise<{ text: string }> {
    return { text: '' };
  }
}

@Injectable()
export class MockTtsProvider implements TtsProvider {
  async synthesize(_input: TtsSynthesizeInput): Promise<{ audioUrl: string }> {
    return { audioUrl: 'https://mock-storage.local/tts.mp3' };
  }
}

@Injectable()
export class NoOpActionValidator implements ActionValidator {
  async validateWrite(_context: ActionValidationContext): Promise<void> {
    return;
  }

  async validateCreateAppointment(_context: ActionValidationContext): Promise<void> {
    return;
  }
}

@Injectable()
export class LoggingAuditService implements AuditService {
  constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  async log(input: AuditLogInput): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: 'audit_log',
        ...input,
      }),
      'AuditService',
    );
  }
}
