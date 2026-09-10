import type { StateEntityExtractorResult } from './state-entity-types';

export function isDeterministicStateEntityResult(result: StateEntityExtractorResult): boolean {
  if (result.recognizedAs === 'unknown') {
    return false;
  }
  if (result.needsClarification) {
    return false;
  }
  if (result.confidence < 0.85) {
    return false;
  }
  return true;
}
