export type EmbeddingInput = {
  text: string;
  clinicId?: string;
  knowledgeId?: string;
};

export type EmbeddingResult = {
  vector: number[];
  model: string;
  dimensions: number;
};

export interface EmbeddingProvider {
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}
