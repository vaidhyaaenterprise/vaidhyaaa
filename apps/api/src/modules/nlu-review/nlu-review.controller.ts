import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { AppError, patchNluReviewItemSchema, type AuthContext } from '@vaidya/shared';

import { Roles } from '../../common/decorators/roles.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';

import { NluReviewAdminService } from './nlu-review-admin.service';

@Controller('internal/nlu-review')
export class NluReviewController {
  constructor(@Inject(NluReviewAdminService) private readonly nluReviewAdmin: NluReviewAdminService) {}

  @Get('items')
  @Roles('clinic_admin', 'platform_admin')
  async listItems(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Query('review_status') reviewStatus?: string,
  ) {
    const auth = getAuthContext(request);
    const clinicId = auth.clinicId;
    if (!clinicId) {
      return { items: [] };
    }
    const items = await this.nluReviewAdmin.listReviewItems(clinicId, reviewStatus);
    return { items };
  }

  @Get('items/:reviewItemId')
  @Roles('clinic_admin', 'platform_admin')
  async getItem(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Param('reviewItemId') reviewItemId: string,
  ) {
    const auth = getAuthContext(request);
    const clinicId = auth.clinicId;
    if (!clinicId) {
      throw new AppError('VALIDATION_ERROR', 'clinic_id is required.');
    }
    const item = await this.nluReviewAdmin.getReviewItem(clinicId, reviewItemId);
    return { item };
  }

  @Patch('items/:reviewItemId')
  @Roles('clinic_admin', 'platform_admin')
  async reviewItem(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Param('reviewItemId') reviewItemId: string,
    @Body() body: unknown,
  ) {
    const auth = getAuthContext(request);
    const clinicId = auth.clinicId;
    if (!clinicId) {
      throw new AppError('VALIDATION_ERROR', 'clinic_id is required.');
    }

    const parsed = patchNluReviewItemSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid NLU review payload.');
    }

    const item = await this.nluReviewAdmin.markReviewed(
      clinicId,
      reviewItemId,
      parsed.data,
      auth.userId,
    );
    return { item };
  }

  @Post('export')
  @Roles('clinic_admin', 'platform_admin')
  async exportReviewed(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const clinicId = auth.clinicId;
    if (!clinicId) {
      throw new AppError('VALIDATION_ERROR', 'clinic_id is required.');
    }
    return this.nluReviewAdmin.exportReviewedItems(clinicId);
  }
}
