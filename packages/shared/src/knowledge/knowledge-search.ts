export type KnowledgeSearchProvider = 'text' | 'pgvector' | 'hybrid';

export type KnowledgeSearchInput = {
  clinicId: string;
  query: string;
  languageCode?: string | null;
  categoryHint?: string | null;
  limit?: number;
};

export type KnowledgeSearchResult = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  sourceFile: string | null;
  sourcePage: number | null;
  score: number;
  searchProvider: KnowledgeSearchProvider;
  embeddingModel?: string | null;
};

export interface KnowledgeSearchTool {
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
}
