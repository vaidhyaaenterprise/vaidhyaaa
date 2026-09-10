import { LlmJsonParser } from './llm-json-parser';
import { parseReceptionistDialogPlan, type ReceptionistDialogPlan } from './receptionist-dialog-types';

const jsonParser = new LlmJsonParser();

export function parseReceptionistDialogPlanFromContent(
  content: string | null | undefined,
): ReceptionistDialogPlan | null {
  const parsed = jsonParser.parseObject<Record<string, unknown>>(content);
  if (!parsed.ok) {
    return null;
  }
  return parseReceptionistDialogPlan(parsed.value);
}
