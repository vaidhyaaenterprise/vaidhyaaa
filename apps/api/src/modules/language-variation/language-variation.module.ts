import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { LanguageVariationAdminService } from './language-variation-admin.service';
import { LanguageVariationController } from './language-variation.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [LanguageVariationController],
  providers: [LanguageVariationAdminService],
  exports: [LanguageVariationAdminService],
})
export class LanguageVariationModule {}
