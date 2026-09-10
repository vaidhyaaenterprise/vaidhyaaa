import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';

import { TemplateRenderer } from './template-renderer.service';

@Module({
  imports: [DatabaseModule],
  providers: [TemplateRenderer],
  exports: [TemplateRenderer],
})
export class TemplateModule {}
