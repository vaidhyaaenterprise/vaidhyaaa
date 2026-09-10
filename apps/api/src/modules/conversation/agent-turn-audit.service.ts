import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService, type DatabaseConnection } from '@vaidya/db';
import { sanitizeAuditMessagePreview } from '@vaidya/shared';

import { DATABASE_CONNECTION } from '../database/database.module';

@Injectable()
export class AgentTurnAuditService {
  private readonly db: DatabaseService;

  constructor(@Inject(DATABASE_CONNECTION) connection: DatabaseConnection) {
    this.db = new DatabaseService(connection.db);
  }

  async recordToolCall(input: {
    clinicId: string;
    sessionId: string;
    toolName: string;
    args: Record<string, unknown>;
    result: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insertAuditLog({
      clinicId: input.clinicId,
      actorType: 'agent',
      eventType: 'agent_tool_call',
      entityType: 'conversation_session',
      entityId: input.sessionId,
      source: 'receptionist_agent',
      eventData: {
        session_id: input.sessionId,
        tool_name: input.toolName,
        args: input.args,
        result: input.result,
      },
    });
  }

  async recordAgentReply(input: {
    clinicId: string;
    sessionId: string;
    replyText: string;
    toolsUsed: string[];
    guardrailFlags?: string[];
  }): Promise<void> {
    await this.db.insertAuditLog({
      clinicId: input.clinicId,
      actorType: 'agent',
      eventType: 'agent_turn_reply',
      entityType: 'conversation_session',
      entityId: input.sessionId,
      source: 'receptionist_agent',
      eventData: {
        session_id: input.sessionId,
        tools_used: input.toolsUsed,
        reply_preview: sanitizeAuditMessagePreview(input.replyText),
        guardrail_flags: input.guardrailFlags ?? [],
      },
    });
  }
}
