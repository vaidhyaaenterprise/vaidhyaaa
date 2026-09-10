export type KnowledgeSearchTextInput = {
  question: string;
  answer: string;
  category?: string | null;
  alternativePhrases?: string[] | null;
};

export function buildKnowledgeSearchText(input: KnowledgeSearchTextInput): string {
  const phrases = (input.alternativePhrases ?? []).filter((phrase) => phrase.trim().length > 0);
  const parts = [
    input.category?.trim() ? `Category: ${input.category.trim()}` : null,
    `Question: ${input.question.trim()}`,
    phrases.length > 0 ? `Alternative phrases: ${phrases.join(', ')}` : null,
    `Answer: ${input.answer.trim()}`,
  ].filter((part): part is string => Boolean(part));

  return parts.join('\n').replace(/\s+/g, ' ').trim();
}
