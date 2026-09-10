import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import {
  addLanguagePackWordsSchema,
  AppError,
  createLanguagePackSchema,
  createReviewedExampleSchema,
} from '@vaidya/shared';

import { Roles } from '../../common/decorators/roles.decorator';

import { LanguageVariationAdminService } from './language-variation-admin.service';

@Controller('internal/language-variation')
export class LanguageVariationController {
  constructor(
    @Inject(LanguageVariationAdminService)
    private readonly languageVariationAdmin: LanguageVariationAdminService,
  ) {}

  @Get('language-packs/:languageCode')
  @Roles('platform_admin')
  async getLanguagePack(@Param('languageCode') languageCode: string) {
    const pack = await this.languageVariationAdmin.getLanguagePack(languageCode);
    return { pack };
  }

  @Patch('language-packs/:languageCode/words')
  @Roles('platform_admin')
  async addLanguagePackWords(
    @Param('languageCode') languageCode: string,
    @Body() body: unknown,
  ) {
    const parsed = addLanguagePackWordsSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid language pack words payload.');
    }
    const pack = await this.languageVariationAdmin.addLanguagePackWords(languageCode, parsed.data);
    return { pack };
  }

  @Post('language-packs')
  @Roles('platform_admin')
  async createLanguagePack(@Body() body: unknown) {
    const parsed = createLanguagePackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid language pack payload.');
    }
    const pack = await this.languageVariationAdmin.createLanguagePack({
      language_code: parsed.data.language_code,
      display_name: parsed.data.display_name,
      ...(parsed.data.yes_words !== undefined ? { yes_words: parsed.data.yes_words } : {}),
      ...(parsed.data.no_words !== undefined ? { no_words: parsed.data.no_words } : {}),
      ...(parsed.data.today_words !== undefined ? { today_words: parsed.data.today_words } : {}),
      ...(parsed.data.tomorrow_words !== undefined ? { tomorrow_words: parsed.data.tomorrow_words } : {}),
    });
    return { pack };
  }

  @Post('reviewed-examples')
  @Roles('platform_admin')
  async createReviewedExample(@Body() body: unknown) {
    const parsed = createReviewedExampleSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid reviewed example payload.');
    }
    const example = await this.languageVariationAdmin.createReviewedExample(parsed.data);
    return { example };
  }

  @Post('reviewed-examples/export')
  @Roles('platform_admin')
  async exportReviewedExamples() {
    return this.languageVariationAdmin.exportReviewedExamples();
  }

  @Post('language-packs/propose-from-reviewed-examples')
  @Roles('platform_admin')
  async proposeLanguagePackAdditions(@Query('dry_run') dryRun?: string) {
    return this.languageVariationAdmin.applyProposedLanguagePackAdditions(dryRun !== 'false');
  }
}
