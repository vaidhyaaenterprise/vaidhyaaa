import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DialogManagerEvalCase = {
  name: string;
  category: string;
  context: {
    currentFlow: string;
    currentState: string;
    lastAssistantTemplateKey?: string;
    collected?: Record<string, unknown>;
    activeTask?: {
      flow: string;
      state: string;
      promptKey: string;
      expectedFields?: string[];
    };
  };
  messageVariants: string[];
  expected: {
    turnType: string;
    userMove?: string;
    capability: string;
    handler?: string;
    shouldResumeActiveTask?: boolean;
  };
};

const EVAL_CASES_PATH = join(__dirname, 'agent_dialog_manager_eval_cases.json');

export function loadDialogManagerEvalCases(): DialogManagerEvalCase[] {
  const raw = readFileSync(EVAL_CASES_PATH, 'utf8');
  return JSON.parse(raw) as DialogManagerEvalCase[];
}
