import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  createAgentRegressionApp,
  createConversation,
  findNextFriday,
  sendMessage,
  toolsUsed,
} from './helpers/agent-regression-harness';

describe('A26 agent product regression (PO expectations 1-4)', () => {
  let app: NestFastifyApplication;
  let sql: Awaited<ReturnType<typeof createAgentRegressionApp>>['sql'];
  const fridayDate = findNextFriday();
  let phoneCounter = 0;

  function nextPhone(): string {
    phoneCounter += 1;
    return `+9198700${String(Date.now()).slice(-5)}${phoneCounter}`;
  }

  beforeAll(async () => {
    const harness = await createAgentRegressionApp(fridayDate);
    app = harness.app;
    sql = harness.sql;
  });

  afterAll(async () => {
    delete process.env.CONVERSATION_AGENT_MODE;
    delete process.env.RECEPTIONIST_AGENT_PROVIDER;
    delete process.env.SARVAM_API_KEY;
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('A: any-order collection — rich details once, then Friday morning slots without re-asking', async () => {
    const sessionId = await createConversation(app, nextPhone());

    const first = await sendMessage(app, sessionId, 'book knee pain checkup', 'a26-a-1');
    expect(first.assistant_message.message_text.toLowerCase()).toMatch(/day|name|mobile|number/);

    const second = await sendMessage(
      app,
      sessionId,
      'Priya, 9876543210, Friday morning',
      'a26-a-2',
    );
    const reply = second.assistant_message.message_text.toLowerCase();
    expect(reply).toMatch(/slot|friday|morning|\d{1,2}:\d{2}/);
    expect(reply).not.toMatch(/your name|patient name|phone number|mobile number|which day/);
    expect(second.session.collected_json.patient_name).toBe('Priya');
    expect(second.session.collected_json.reason_for_visit).toBe('knee pain checkup');
    expect(second.session.collected_json.preferred_date).toBe(fridayDate);
    expect(second.session.collected_json.time_preference).toBe('morning');
    expect(toolsUsed(second)).toContain('check_slot_availability');
    expect((second.session.collected_json.proposed_slots as unknown[] | undefined)?.length).toBeGreaterThan(0);
  });

  it('B: mid-booking fee question then resumes slot offer without losing answers', async () => {
    const sessionId = await createConversation(app, nextPhone());

    await sendMessage(app, sessionId, 'book knee pain checkup', 'a26-b-1');
    const details = await sendMessage(
      app,
      sessionId,
      'Priya, 9876543211, Friday morning',
      'a26-b-2',
    );
    expect((details.session.collected_json.proposed_slots as unknown[] | undefined)?.length).toBeGreaterThan(0);

    const fee = await sendMessage(
      app,
      sessionId,
      'how much is the consultation?',
      'a26-b-3',
    );
    const reply = fee.assistant_message.message_text.toLowerCase();
    expect(reply).toMatch(/₹|consultation|fee|1000|500|700/);
    expect(reply).toMatch(/slot|book|\d{1,2}:\d{2}/);
    expect(toolsUsed(fee)).toContain('get_clinic_info');
    expect(fee.session.collected_json.patient_name).toBe('Priya');
    expect(fee.session.collected_json.reason_for_visit).toBe('knee pain checkup');
    expect((fee.session.collected_json.proposed_slots as unknown[] | undefined)?.length).toBeGreaterThan(0);
  });

  it('C: timing paraphrases all answered via get_clinic_info without clarify loops', async () => {
    const variants = [
      'what time do you open',
      'when r u open',
      'clinic timing enna',
      'till what time doctor available',
      'morning open aa?',
    ];

    for (const [index, question] of variants.entries()) {
      const sessionId = await createConversation(app, nextPhone());
      const result = await sendMessage(app, sessionId, question, `a26-c-${index}`);
      const reply = result.assistant_message.message_text.toLowerCase();
      expect(reply).toMatch(/09:00|9:00|17:00|open|mon|tue|wed|thu|fri|sat/);
      expect(reply).not.toMatch(/which detail|clarify|did not understand|unknown/);
      expect(toolsUsed(result)).toContain('get_clinic_info');
    }
  });

  it('D: scope boundary — medical advice refusal and off-topic redirect', async () => {
    const medicalSession = await createConversation(app, nextPhone());
    const medical = await sendMessage(
      app,
      medicalSession,
      'should I take paracetamol for fever?',
      'a26-d-medical',
    );
    const medicalReply = medical.assistant_message.message_text.toLowerCase();
    expect(medicalReply).toMatch(/cannot|can't|medical|doctor|book/);
    expect(medicalReply).not.toMatch(/\d+\s*mg|take \d|paracetamol.*\d/);

    const cricketSession = await createConversation(app, nextPhone());
    const cricket = await sendMessage(
      app,
      cricketSession,
      "what's the cricket score",
      'a26-d-cricket',
    );
    const cricketReply = cricket.assistant_message.message_text.toLowerCase();
    expect(cricketReply).toMatch(/appointment|clinic|help|book|timings/);
    expect(cricketReply).not.toMatch(/score|wicket|runs/);
  });

  it('E: knowledge base MRI fasting answered naturally via search_knowledge_base', async () => {
    const sessionId = await createConversation(app, nextPhone());
    const result = await sendMessage(
      app,
      sessionId,
      'do I need to fast before the MRI?',
      'a26-e-kb',
    );
    const reply = result.assistant_message.message_text.toLowerCase();
    expect(toolsUsed(result)).toContain('search_knowledge_base');
    expect(reply).toMatch(/fast|mri|fasting/);
    expect(reply).not.toMatch(/^\{answer_text\}$|clinic staff will confirm this\.$/);
    expect(reply).not.toMatch(/knowledge\.answer/);
  });

  it('F: no loops — one clarify, varied second clarify, then human callback', async () => {
    const sessionId = await createConversation(app, nextPhone());

    const first = await sendMessage(app, sessionId, 'hmm ok so', 'a26-f-1');
    const firstReply = first.assistant_message.message_text;
    expect(firstReply.length).toBeGreaterThan(5);
    expect(first.session.collected_json.agent_clarify_count).toBe(1);

    const second = await sendMessage(app, sessionId, 'hmm ok so', 'a26-f-2');
    const secondReply = second.assistant_message.message_text;
    expect(secondReply).not.toBe(firstReply);
    expect(second.session.collected_json.agent_clarify_count).toBe(2);

    const third = await sendMessage(app, sessionId, 'hmm ok so', 'a26-f-3');
    const thirdReply = third.assistant_message.message_text.toLowerCase();
    expect(thirdReply).toMatch(/staff|callback|call you back|human/);
    expect(toolsUsed(third)).toContain('request_human_callback');
    expect(third.session.status).toBe('completed');
  });
});
