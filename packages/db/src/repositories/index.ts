import { eq, desc, and, or } from 'drizzle-orm';

import type { Database } from '../client';
import {
  clinicKnowledgeBase,
  clinicLanguages,
  clinicOnboardingChecklist,
  clinicServices,
  clinicSettings,
  clinicSubscriptions,
  clinicUsageMonthly,
  clinics,
  doctorServiceBookingRules,
  doctorServices,
  doctors,
  messageTemplates,
  subscriptionPlans,
  supportedLanguages,
  users,
} from '../schema';
import { AppointmentLifecycleRepository } from './appointment-lifecycle.repository';
import { AuthRepository } from './auth.repository';
import { NotificationRepository } from './notification.repository';
import { OtpRepository } from './otp.repository';
import { PlatformOpsRepository } from './platform-ops.repository';
import { KnowledgeRepository } from './knowledge.repository';
import { NluReviewRepository } from './nlu-review.repository';
import { ReviewedExamplesRepository } from './reviewed-examples.repository';
import { VoiceRepository } from './voice.repository';
import {
  ConversationMessageRepository,
  ConversationSessionRepository,
  MessageIdempotencyRepository,
} from './conversation.repository';
import { DoctorsRepository } from './doctors.repository';
import { PatientsRepository } from './patients.repository';
import { ClinicalSetupRepository } from './clinical-setup.repository';
import { SlotsRepository } from './slots.repository';

export { AuthRepository } from './auth.repository';
export { OtpRepository, type OtpPurpose } from './otp.repository';
export {
  ConversationMessageRepository,
  ConversationSessionRepository,
  MessageIdempotencyRepository,
  type ConversationMessageRow,
  type ConversationSessionRow,
  type MessageIdempotencyRow,
} from './conversation.repository';
export { DoctorsRepository } from './doctors.repository';
export { PatientsRepository } from './patients.repository';
export { ClinicalSetupRepository } from './clinical-setup.repository';
export { SlotsRepository } from './slots.repository';
export { AppointmentLifecycleRepository } from './appointment-lifecycle.repository';
export { NotificationRepository, type NotificationEventRow } from './notification.repository';
export { PlatformOpsRepository } from './platform-ops.repository';
export {
  KnowledgeRepository,
  computeEmbeddingSourceHash,
  normalizeQuestionSignature,
  type KnowledgeEntryRow,
  type KnowledgeEmbeddingStatusSummary,
  type ManualTemplateEntryRow,
  type KnowledgeVectorSearchRow,
} from './knowledge.repository';
export {
  NluReviewRepository,
  type CreateNluReviewItemInput,
  type NluReviewItemRow,
  type ReviewNluReviewItemInput,
} from './nlu-review.repository';
export {
  ReviewedExamplesRepository,
  type CreateReviewedExampleInput,
  type ReviewedExampleRow,
} from './reviewed-examples.repository';
export { VoiceRepository, type CallRow } from './voice.repository';
export class ClinicsRepository {
  constructor(private readonly db: Database) {}

  findClinicById(clinicId: string) {
    return this.db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
  }

  findClinicUniqueNumber(clinicId: string) {
    return this.db
      .select({ uniqueNumber: clinics.uniqueNumber })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
  }

  getClinicLocation(clinicId: string) {
    return this.db
      .select({
        name: clinics.name,
        uniqueNumber: clinics.uniqueNumber,
        primaryPhone: clinics.primaryPhone,
        addressLine1: clinics.addressLine1,
        addressLine2: clinics.addressLine2,
        city: clinics.city,
        state: clinics.state,
        postalCode: clinics.postalCode,
        country: clinics.country,
        timezone: clinics.timezone,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
  }

  findClinicByPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');
    return this.db
      .select()
      .from(clinics)
      .where(
        or(
          eq(clinics.primaryPhone, digits),
          eq(clinics.primaryPhone, phone),
          eq(clinics.primaryPhone, `+${digits}`),
        ),
      )
      .limit(1);
  }

  findClinicSettings(clinicId: string) {
    return this.db
      .select()
      .from(clinicSettings)
      .where(eq(clinicSettings.clinicId, clinicId))
      .limit(1);
  }

  findOnboardingChecklist(clinicId: string) {
    return this.db
      .select()
      .from(clinicOnboardingChecklist)
      .where(eq(clinicOnboardingChecklist.clinicId, clinicId))
      .limit(1);
  }

  updateClinicSettings(
    clinicId: string,
    values: Partial<typeof clinicSettings.$inferInsert>,
  ) {
    return this.db
      .update(clinicSettings)
      .set(values)
      .where(eq(clinicSettings.clinicId, clinicId))
      .returning();
  }
}

export class ClinicalRepository {
  constructor(private readonly db: Database) {}

  listDoctors(clinicId: string) {
    return this.db.select().from(doctors).where(eq(doctors.clinicId, clinicId));
  }

  listServices(clinicId: string) {
    return this.db.select().from(clinicServices).where(eq(clinicServices.clinicId, clinicId));
  }

  listBookingRules(clinicId: string) {
    return this.db
      .select()
      .from(doctorServiceBookingRules)
      .where(eq(doctorServiceBookingRules.clinicId, clinicId));
  }

  listKnowledge(clinicId: string) {
    return this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(eq(clinicKnowledgeBase.clinicId, clinicId));
  }

  getDoctorFeeInfo(clinicId: string, doctorId: string) {
    return this.db
      .select({
        doctorServiceId: doctorServices.id,
        consultationFeeAmount: doctorServices.consultationFeeAmount,
        followupFeeAmount: doctorServices.followupFeeAmount,
      })
      .from(doctorServices)
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.doctorId, doctorId),
          eq(doctorServices.active, true),
        ),
      )
      .limit(1);
  }

  async searchApprovedKnowledge(clinicId: string, queryText: string) {
    const normalized = queryText.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    const rows = await this.db
      .select()
      .from(clinicKnowledgeBase)
      .where(
        and(
          eq(clinicKnowledgeBase.clinicId, clinicId),
          eq(clinicKnowledgeBase.status, 'approved'),
        ),
      );

    let best: (typeof rows)[number] | null = null;
    let bestScore = 0;

    for (const row of rows) {
      const haystacks = [
        row.question,
        row.searchText ?? '',
        ...((row.alternativePhrasesJson as string[] | null) ?? []),
      ].map((value) => value.toLowerCase());

      let score = 0;
      for (const haystack of haystacks) {
        if (haystack.includes(normalized)) {
          score = Math.max(score, normalized.length + 10);
        }
        const tokens = normalized.split(' ').filter((token) => token.length > 2);
        const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
        score = Math.max(score, matchedTokens * 3);
      }

      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    return bestScore > 0 ? best : null;
  }

  listActiveDoctorServicesForClinicService(clinicId: string, clinicServiceId: string) {
    return this.db
      .select({
        doctorServiceId: doctorServices.id,
        doctorId: doctors.id,
        doctorName: doctors.name,
        doctorActive: doctors.active,
        clinicServiceId: clinicServices.id,
      })
      .from(doctorServices)
      .innerJoin(doctors, and(eq(doctors.clinicId, doctorServices.clinicId), eq(doctors.id, doctorServices.doctorId)))
      .innerJoin(
        clinicServices,
        and(eq(clinicServices.clinicId, doctorServices.clinicId), eq(clinicServices.id, doctorServices.clinicServiceId)),
      )
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.clinicServiceId, clinicServiceId),
          eq(doctorServices.active, true),
          eq(clinicServices.active, true),
        ),
      );
  }

  listActiveDoctorServicesForDoctor(clinicId: string, doctorId: string) {
    return this.db
      .select({
        doctorServiceId: doctorServices.id,
        doctorId: doctors.id,
        doctorName: doctors.name,
        doctorActive: doctors.active,
        clinicServiceId: clinicServices.id,
      })
      .from(doctorServices)
      .innerJoin(doctors, and(eq(doctors.clinicId, doctorServices.clinicId), eq(doctors.id, doctorServices.doctorId)))
      .innerJoin(
        clinicServices,
        and(eq(clinicServices.clinicId, doctorServices.clinicId), eq(clinicServices.id, doctorServices.clinicServiceId)),
      )
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.doctorId, doctorId),
          eq(doctorServices.active, true),
          eq(clinicServices.active, true),
        ),
      );
  }

  findDoctorByNameFragment(clinicId: string, nameFragment: string) {
    const normalized = nameFragment.toLowerCase().replace(/^(dr\.?\s*|doctor\s+)/, '');
    return this.db
      .select()
      .from(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.active, true)))
      .then((rows) =>
        rows.filter((doctor) => doctor.name.toLowerCase().includes(normalized)),
      );
  }

  isDoctorMappedToService(clinicId: string, doctorId: string, clinicServiceId: string) {
    return this.db
      .select({ id: doctorServices.id })
      .from(doctorServices)
      .where(
        and(
          eq(doctorServices.clinicId, clinicId),
          eq(doctorServices.doctorId, doctorId),
          eq(doctorServices.clinicServiceId, clinicServiceId),
          eq(doctorServices.active, true),
        ),
      )
      .limit(1);
  }

  listTemplates() {
    return this.db.select().from(messageTemplates);
  }

  findMessageTemplate(templateKey: string, languageCode: string) {
    return this.db
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.templateKey, templateKey),
          eq(messageTemplates.languageCode, languageCode),
          eq(messageTemplates.active, true),
        ),
      )
      .limit(1);
  }

  findSupportedLanguage(languageCode: string) {
    return this.db
      .select()
      .from(supportedLanguages)
      .where(eq(supportedLanguages.languageCode, languageCode))
      .limit(1);
  }
}

export class UsersRepository {
  constructor(private readonly db: Database) {}

  findUserById(userId: string) {
    return this.db.select().from(users).where(eq(users.id, userId)).limit(1);
  }

  updatePasswordHash(userId: string, input: { hash: string; salt: string }) {
    return this.db
      .update(users)
      .set({ passwordHash: input.hash, passwordSalt: input.salt, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
  }
}

export class PlatformRepository {
  constructor(private readonly db: Database) {}

  listClinics() {
    return this.db.select().from(clinics).orderBy(desc(clinics.createdAt));
  }

  findSubscriptionPlanByKey(planKey: string) {
    return this.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.planKey, planKey))
      .limit(1);
  }

  findClinicSubscription(clinicId: string) {
    return this.db
      .select()
      .from(clinicSubscriptions)
      .where(eq(clinicSubscriptions.clinicId, clinicId))
      .limit(1);
  }

  listClinicLanguages(clinicId: string) {
    return this.db
      .select()
      .from(clinicLanguages)
      .where(eq(clinicLanguages.clinicId, clinicId));
  }

  listSupportedLanguages() {
    return this.db.select().from(supportedLanguages);
  }

  async replaceClinicLanguages(
    clinicId: string,
    defaultLanguageCode: string,
    languages: Array<{ languageCode: string; enabled: boolean }>,
  ) {
    await this.db.delete(clinicLanguages).where(eq(clinicLanguages.clinicId, clinicId));
    if (languages.length === 0) {
      return [];
    }
    return this.db
      .insert(clinicLanguages)
      .values(
        languages.map((row) => ({
          clinicId,
          languageCode: row.languageCode,
          enabled: row.enabled,
          isDefault: row.languageCode === defaultLanguageCode,
        })),
      )
      .returning();
  }

  findUsageForMonth(clinicId: string, billingMonth: string) {
    return this.db
      .select()
      .from(clinicUsageMonthly)
      .where(
        and(
          eq(clinicUsageMonthly.clinicId, clinicId),
          eq(clinicUsageMonthly.billingMonth, billingMonth),
        ),
      )
      .limit(1);
  }

  listSubscriptionPlans() {
    return this.db.select().from(subscriptionPlans);
  }

  updateClinicSubscription(
    clinicId: string,
    values: Partial<typeof clinicSubscriptions.$inferInsert>,
  ) {
    return this.db
      .update(clinicSubscriptions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(clinicSubscriptions.clinicId, clinicId))
      .returning();
  }

  updateClinic(
    clinicId: string,
    values: Partial<typeof clinics.$inferInsert>,
  ) {
    return this.db.update(clinics).set(values).where(eq(clinics.id, clinicId)).returning();
  }
}

export function createRepositories(db: Database) {
  return {
    clinics: new ClinicsRepository(db),
    clinical: new ClinicalRepository(db),
    clinicalSetup: new ClinicalSetupRepository(db),
    users: new UsersRepository(db),
    auth: new AuthRepository(db),
    otp: new OtpRepository(db),
    platform: new PlatformRepository(db),
    doctors: new DoctorsRepository(db),
    patients: new PatientsRepository(db),
    slots: new SlotsRepository(db),
    conversationSessions: new ConversationSessionRepository(db),
    conversationMessages: new ConversationMessageRepository(db),
    messageIdempotency: new MessageIdempotencyRepository(db),
    appointmentLifecycle: new AppointmentLifecycleRepository(db),
    notification: new NotificationRepository(db),
    platformOps: new PlatformOpsRepository(db),
    knowledge: new KnowledgeRepository(db),
    nluReview: new NluReviewRepository(db),
    reviewedExamples: new ReviewedExamplesRepository(db),
    voice: new VoiceRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
