import { Inject, Injectable } from '@nestjs/common';

import { createRepositories, type Repositories } from '@vaidya/db';
import {
  getCodeTemplateText,
  type LanguageCode,
  MESSAGE_TEMPLATE_KEYS,
  type MessageTemplateKey,
} from '@vaidya/shared';

import type { DatabaseConnection } from '@vaidya/db';

import { DATABASE_CONNECTION } from '../database/database.module';

export interface RenderedTemplate {
  template_key: string;
  language_code: LanguageCode;
  message_text: string;
}

@Injectable()
export class TemplateRenderer {
  private readonly repos: Repositories;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.repos = createRepositories(connection.db);
  }

  async render(
    templateKey: MessageTemplateKey | string,
    languageCode: LanguageCode,
    variables: Record<string, string>,
  ): Promise<RenderedTemplate> {
    const [direct] = await this.repos.clinical.findMessageTemplate(templateKey, languageCode);
    if (direct) {
      return {
        template_key: templateKey,
        language_code: languageCode,
        message_text: this.interpolate(direct.templateText, variables),
      };
    }

    const [languageMeta] = await this.repos.clinical.findSupportedLanguage(languageCode);
    const fallbackLanguage = languageMeta?.fallbackLanguageCode;
    if (fallbackLanguage) {
      const [fallback] = await this.repos.clinical.findMessageTemplate(
        templateKey,
        fallbackLanguage,
      );
      if (fallback) {
        return {
          template_key: templateKey,
          language_code: fallbackLanguage as LanguageCode,
          message_text: this.interpolate(fallback.templateText, variables),
        };
      }
    }

    const codeText = getCodeTemplateText(templateKey as MessageTemplateKey, languageCode);
    return {
      template_key: templateKey,
      language_code: languageCode,
      message_text: this.interpolate(
        codeText ?? `[missing template: ${templateKey}]`,
        variables,
      ),
    };
  }

  isKnownTemplateKey(templateKey: string): templateKey is MessageTemplateKey {
    return (MESSAGE_TEMPLATE_KEYS as readonly string[]).includes(templateKey);
  }

  private interpolate(templateText: string, variables: Record<string, string>): string {
    return templateText.replace(/\{([a-z_]+)\}/gi, (_match, key: string) => {
      return variables[key] ?? `{${key}}`;
    });
  }
}
