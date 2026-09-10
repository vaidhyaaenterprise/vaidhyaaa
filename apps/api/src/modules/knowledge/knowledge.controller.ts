import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import {
  AppError,
  createKnowledgeEntrySchema,
  patchKnowledgeEntrySchema,
  type AuthContext,
} from '@vaidya/shared';

import { Roles } from '../../common/decorators/roles.decorator';
import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';

import { KnowledgeAdminService } from './knowledge-admin.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(@Inject(KnowledgeAdminService) private readonly knowledgeAdmin: KnowledgeAdminService) {}

  @Get('embedding-status')
  @Roles('clinic_admin')
  async getEmbeddingStatus(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
  ) {
    const auth = getAuthContext(request);
    const clinicId = auth.clinicId;
    if (!clinicId) {
      return { embedding_status: null };
    }
    const summary = await this.knowledgeAdmin.getEmbeddingStatus(clinicId);
    return {
      embedding_status: {
        approved_total: summary.approvedTotal,
        generated_count: summary.generatedCount,
        pending_count: summary.pendingCount,
        failed_count: summary.failedCount,
        stale_count: summary.staleCount,
        not_required_count: summary.notRequiredCount,
      },
    };
  }

  @Get('entries')
  @Roles('clinic_admin')
  async listEntries(@Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext }) {
    const auth = getAuthContext(request);
    if (!auth.clinicId) {
      return { entries: [] };
    }
    const entries = await this.knowledgeAdmin.listEntries(auth.clinicId);
    return { entries };
  }

  @Get('manual-template')
  @Roles('clinic_admin')
  async listManualTemplate(@Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext }) {
    const auth = getAuthContext(request);
    if (!auth.clinicId) {
      return { template: null };
    }
    const template = await this.knowledgeAdmin.listManualTemplate(auth.clinicId);
    return { template };
  }

  @Post('manual-template/import')
  @Roles('clinic_admin')
  async importManualTemplate(@Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext }) {
    const auth = getAuthContext(request);
    if (!auth.clinicId) {
      throw new AppError('FORBIDDEN', 'Clinic context is required.');
    }
    const result = await this.knowledgeAdmin.importManualTemplate({ clinicId: auth.clinicId });
    return { result };
  }

  @Post('manual')
  @Roles('clinic_admin')
  async createManualEntry(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Body() body: unknown,
  ) {
    const auth = getAuthContext(request);
    if (!auth.clinicId) {
      throw new AppError('FORBIDDEN', 'Clinic context is required.');
    }

    const parsed = createKnowledgeEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid knowledge entry payload.');
    }

    const knowledge = await this.knowledgeAdmin.createManualEntry({
      clinicId: auth.clinicId,
      payload: parsed.data,
    });

    return { knowledge };
  }

  @Post('embeddings/regenerate')
  @Roles('clinic_admin')
  async regenerateEmbeddings(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Body() body: { clinic_id: string; only_status?: 'approved' | 'all' },
  ) {
    const auth = getAuthContext(request);
    return this.knowledgeAdmin.regenerateEmbeddings({
      clinicId: body.clinic_id,
      onlyStatus: body.only_status ?? 'approved',
      requestedByUserId: auth.userId,
    });
  }

  @Post(':knowledgeId/embedding/retry')
  @Roles('clinic_admin')
  async retryEmbedding(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Param('knowledgeId') knowledgeId: string,
    @Body() body: { clinic_id?: string },
  ) {
    const auth = getAuthContext(request);
    const clinicId = body.clinic_id ?? auth.clinicId;
    if (!clinicId) {
      return { queued: false };
    }
    return this.knowledgeAdmin.retryEmbedding({
      clinicId,
      knowledgeId,
      requestedByUserId: auth.userId,
    });
  }

  @Patch(':knowledgeId')
  @Roles('clinic_admin')
  async patchKnowledgeEntry(
    @Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext },
    @Param('knowledgeId') knowledgeId: string,
    @Body() body: unknown,
  ) {
    const auth = getAuthContext(request);
    const parsed = patchKnowledgeEntrySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid knowledge entry payload.');
    }

    const clinicId =
      typeof body === 'object' &&
      body !== null &&
      'clinic_id' in body &&
      typeof (body as { clinic_id?: unknown }).clinic_id === 'string'
        ? (body as { clinic_id: string }).clinic_id
        : auth.clinicId;

    if (!clinicId) {
      return { knowledge: null };
    }

    const knowledge = await this.knowledgeAdmin.patchKnowledgeEntry({
      clinicId,
      knowledgeId,
      patch: parsed.data,
      actorUserId: auth.userId,
    });
    return { knowledge };
  }
}
