import { Module } from '@nestjs/common';

import { AdaptersModule } from '../../common/adapters/adapters.module';

import { TemplateModule } from '../conversation/template.module';

import { KnowledgeAdminService } from './knowledge-admin.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeRuntimeHandler } from './knowledge-runtime-handler.service';
import { KnowledgeSearchFactory } from './knowledge-search.factory';
import { HybridKnowledgeSearchTool } from './knowledge-search-tools/hybrid-knowledge-search.tool';
import { PgVectorKnowledgeSearchTool } from './knowledge-search-tools/pgvector-knowledge-search.tool';
import { SimpleTextKnowledgeSearchTool } from './knowledge-search-tools/simple-text-knowledge-search.tool';
import { KnowledgeSearchService } from './knowledge-search.service';

@Module({
  imports: [TemplateModule, AdaptersModule],
  controllers: [KnowledgeController],
  providers: [
    SimpleTextKnowledgeSearchTool,
    PgVectorKnowledgeSearchTool,
    HybridKnowledgeSearchTool,
    KnowledgeSearchFactory,
    KnowledgeSearchService,
    KnowledgeRuntimeHandler,
    KnowledgeEmbeddingService,
    KnowledgeAdminService,
  ],
  exports: [
    KnowledgeSearchService,
    KnowledgeRuntimeHandler,
    KnowledgeEmbeddingService,
    KnowledgeAdminService,
  ],
})
export class KnowledgeModule {}
