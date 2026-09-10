import { Inject, Injectable } from '@nestjs/common';

import {
  type MessagingProvider,
  type MessagingSendInput,
  type NotificationProvider,
  type NotificationSendInput,
} from '@vaidya/shared';

@Injectable()
export class ConfigurableMockMessagingProvider implements MessagingProvider {
  static failUntilAttempt = 0;
  static sendAttempts = 0;
  static alwaysFail = false;

  static reset(): void {
    ConfigurableMockMessagingProvider.failUntilAttempt = 0;
    ConfigurableMockMessagingProvider.sendAttempts = 0;
    ConfigurableMockMessagingProvider.alwaysFail = false;
  }

  private async deliver(_channel: 'whatsapp' | 'sms', _input: MessagingSendInput) {
    ConfigurableMockMessagingProvider.sendAttempts += 1;
    const attempt = ConfigurableMockMessagingProvider.sendAttempts;

    if (
      ConfigurableMockMessagingProvider.alwaysFail ||
      attempt <= ConfigurableMockMessagingProvider.failUntilAttempt
    ) {
      throw new Error('mock_messaging_provider_failure');
    }

    return {
      providerMessageId: `mock_message_${attempt}`,
    };
  }

  async sendWhatsApp(input: MessagingSendInput) {
    return this.deliver('whatsapp', input);
  }

  async sendSms(input: MessagingSendInput) {
    return this.deliver('sms', input);
  }
}

@Injectable()
export class MockMessagingProviderAdapter implements NotificationProvider {
  constructor(
    @Inject(ConfigurableMockMessagingProvider)
    private readonly messaging: ConfigurableMockMessagingProvider,
  ) {}

  async send(input: NotificationSendInput): Promise<{ providerMessageId: string }> {
    const payload = {
      recipient: input.recipient,
      templateKey: input.templateKey,
      payload: input.payload,
    };

    if (input.channel === 'sms') {
      return this.messaging.sendSms(payload);
    }

    if (input.channel === 'whatsapp') {
      return this.messaging.sendWhatsApp(payload);
    }

    return { providerMessageId: `mock_dashboard_${Date.now()}` };
  }
}
