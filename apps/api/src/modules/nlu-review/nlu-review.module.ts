import { Module } from '@nestjs/common';

import { NluReviewAdminService } from './nlu-review-admin.service';
import { NluReviewController } from './nlu-review.controller';

@Module({
  controllers: [NluReviewController],
  providers: [NluReviewAdminService],
  exports: [NluReviewAdminService],
})
export class NluReviewModule {}
