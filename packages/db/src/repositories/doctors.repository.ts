import { and, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { clinicUsers, doctors, users } from '../schema';

export class DoctorsRepository {
  constructor(private readonly db: Database) {}

  createDoctor(input: {
    clinicId: string;
    name: string;
    qualification?: string | undefined;
  }) {
    return this.db
      .insert(doctors)
      .values({
        clinicId: input.clinicId,
        name: input.name,
        ...(input.qualification ? { qualification: input.qualification } : {}),
        userId: null,
        active: true,
      })
      .returning();
  }

  async linkDoctorLogin(input: {
    clinicId: string;
    doctorId: string;
    name: string;
    email?: string;
    phone?: string;
    invitedByUserId: string;
  }) {
    const [doctor] = await this.db
      .select()
      .from(doctors)
      .where(and(eq(doctors.clinicId, input.clinicId), eq(doctors.id, input.doctorId)))
      .limit(1);

    if (!doctor) {
      return null;
    }

    const [user] = await this.db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        active: true,
      })
      .returning();

    if (!user) {
      return null;
    }

    await this.db
      .update(doctors)
      .set({ userId: user.id })
      .where(and(eq(doctors.clinicId, input.clinicId), eq(doctors.id, input.doctorId)));

    await this.db.insert(clinicUsers).values({
      clinicId: input.clinicId,
      userId: user.id,
      role: 'doctor',
      doctorId: input.doctorId,
      active: true,
      invitedByUserId: input.invitedByUserId,
    });

    return { doctor, user };
  }

  findDoctorById(clinicId: string, doctorId: string) {
    return this.db
      .select()
      .from(doctors)
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctorId)))
      .limit(1);
  }

  updateDoctorActive(clinicId: string, doctorId: string, active: boolean) {
    return this.db
      .update(doctors)
      .set({ active })
      .where(and(eq(doctors.clinicId, clinicId), eq(doctors.id, doctorId)))
      .returning();
  }
}
