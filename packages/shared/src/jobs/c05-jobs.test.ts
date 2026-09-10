import { describe, expect, it } from 'vitest';

import { AppError } from '../errors/index';
import {
  ALL_JOB_TYPES,
  ALL_QUEUE_NAMES,
  JOB_QUEUE_MAP,
  JOB_TYPES,
  QUEUE_NAMES,
  validateJobPayload,
} from './index';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';

describe('C05 job foundation contracts', () => {
  it('registers all required queue names', () => {
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.NOTIFICATIONS);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.SLOT_HOLDS);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.SLOT_GENERATION);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.RECORDINGS_CLEANUP);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.TRANSCRIPTS_CLEANUP);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.KNOWLEDGE_PROCESSING);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.EMBEDDINGS);
    expect(ALL_QUEUE_NAMES).toContain(QUEUE_NAMES.DAILY_REPORTS);
    expect(ALL_QUEUE_NAMES).toHaveLength(8);
  });

  it('maps every job type to a queue', () => {
    for (const jobType of ALL_JOB_TYPES) {
      expect(JOB_QUEUE_MAP[jobType]).toBeTruthy();
      expect(ALL_QUEUE_NAMES).toContain(JOB_QUEUE_MAP[jobType]);
    }
  });

  it('validates send notification payload', () => {
    const payload = validateJobPayload(JOB_TYPES.SEND_NOTIFICATION, {
      clinic_id: CLINIC_ID,
      notification_event_id: '00000000-0000-0000-0000-000000000010',
      channel: 'whatsapp',
      recipient: '+919840000000',
      template_key: 'booking.created_pending',
    });

    expect(payload.clinic_id).toBe(CLINIC_ID);
  });

  it('rejects invalid job payload safely', () => {
    expect(() =>
      validateJobPayload(JOB_TYPES.SEND_NOTIFICATION, {
        clinic_id: CLINIC_ID,
        channel: 'whatsapp',
      }),
    ).toThrow(AppError);
  });

  it('rejects unknown job types', () => {
    expect(() => validateJobPayload('UNKNOWN_JOB', { clinic_id: CLINIC_ID })).toThrow(AppError);
  });
});
