export type LlmJsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw?: string };

export class LlmJsonParser {
  parseObject<T extends Record<string, unknown>>(content: string | null | undefined): LlmJsonParseResult<T> {
    if (!content || content.trim().length === 0) {
      return { ok: false, error: 'empty_content' };
    }

    const trimmed = content.trim();
    const direct = this.tryParse(trimmed);
    if (direct.ok) {
      return direct as LlmJsonParseResult<T>;
    }

    const fenced = this.extractFromCodeFence(trimmed);
    if (fenced) {
      const parsed = this.tryParse(fenced);
      if (parsed.ok) {
        return parsed as LlmJsonParseResult<T>;
      }
    }

    const embedded = this.extractFirstJsonObject(trimmed);
    if (embedded) {
      const parsed = this.tryParse(embedded);
      if (parsed.ok) {
        return parsed as LlmJsonParseResult<T>;
      }
    }

    return { ok: false, error: 'invalid_json', raw: trimmed };
  }

  private tryParse(value: string): LlmJsonParseResult<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'not_object', raw: value };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false, error: 'invalid_json', raw: value };
    }
  }

  private extractFromCodeFence(value: string): string | null {
    const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return match?.[1]?.trim() ?? null;
  }

  private extractFirstJsonObject(value: string): string | null {
    const start = value.indexOf('{');
    if (start < 0) {
      return null;
    }

    let depth = 0;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return value.slice(start, index + 1);
        }
      }
    }

    return null;
  }
}
