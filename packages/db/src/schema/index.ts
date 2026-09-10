export * from './tables/clinics';
export * from './tables/auth';
export * from './tables/clinical';
export * from './tables/appointments';
export * from './tables/platform';
export * from './tables/subscriptions';
export * from './tables/conversations';
export * from './tables/appointment-lifecycle';
export * from './tables/scheduling';
export * from './tables/slot-management';
export * from './tables/extended';
export * from './tables/background-jobs';
export * from './tables/otp';

import * as auth from './tables/auth';
import * as appointments from './tables/appointments';
import * as appointmentLifecycle from './tables/appointment-lifecycle';
import * as backgroundJobs from './tables/background-jobs';
import * as clinical from './tables/clinical';
import * as clinics from './tables/clinics';
import * as conversations from './tables/conversations';
import * as extended from './tables/extended';
import * as platform from './tables/platform';
import * as otp from './tables/otp';
import * as scheduling from './tables/scheduling';
import * as slotManagement from './tables/slot-management';
import * as subscriptions from './tables/subscriptions';

/** Drizzle schema map — mirrors SQL baseline, not auto-generated. */
export const schema = {
  ...clinics,
  ...auth,
  ...clinical,
  ...appointments,
  ...appointmentLifecycle,
  ...scheduling,
  ...slotManagement,
  ...platform,
  ...subscriptions,
  ...extended,
  ...conversations,
  ...backgroundJobs,
  ...otp,
};

export type VaidyaSchema = typeof schema;

export const SCHEMA_BASELINE = '001_initial_schema_production';
