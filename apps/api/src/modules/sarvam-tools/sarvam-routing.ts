export type DoctorChoice = { doctorId: string; doctorName: string; qualification: string | null };
export type RoutingService = {
  clinicServiceId: string;
  name: string;
  serviceKey: string;
  doctors: DoctorChoice[];
  handlesJson: unknown;
  doesNotHandleJson: unknown;
  redFlagsJson: unknown;
  routingExamplesJson: unknown;
};
export type RoutingInput = {
  doctorId?: string | null;
  doctorName?: string | null;
  clinicServiceId?: string | null;
  serviceKey?: string | null;
  reasonForVisit?: string | null;
};

/** Flat text for Sarvam's response-field-to-variable mappings. IDs stay internal. */
export function doctorChoicesText(doctors: DoctorChoice[]) {
  return doctors
    .map(
      (doctor) =>
        `${doctor.doctorName}${doctor.qualification ? ` (${doctor.qualification})` : ''} | doctor_id=${doctor.doctorId}`,
    )
    .join('\n');
}

export function publicService(service: RoutingService) {
  return {
    clinicServiceId: service.clinicServiceId,
    name: service.name,
    serviceName: service.name,
    serviceKey: service.serviceKey,
    doctors: service.doctors,
    handles: service.handlesJson ?? [],
    doesNotHandle: service.doesNotHandleJson ?? [],
    routingExamples: service.routingExamplesJson ?? [],
  };
}

export function normalizeDoctorName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/^(?:dr\.?\s+|dr\.|doctor\s+)/u, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function doctorNameMatches(name: string, requested: string) {
  const normalized = normalizeDoctorName(requested);
  return Boolean(normalized) && ` ${normalizeDoctorName(name)} `.includes(` ${normalized} `);
}

/** Stateless resolution: explicit preferences constrain routing, never silently change service. */
export async function resolveSarvamRouting(
  catalog: RoutingService[],
  input: RoutingInput,
  routeReason: (reason: string) => Promise<string | null>,
) {
  const allDoctors = [
    ...new Map(
      catalog.flatMap((service) => service.doctors).map((doctor) => [doctor.doctorId, doctor]),
    ).values(),
  ];
  const fail = (
    error: string,
    services = catalog,
    doctors: DoctorChoice[] = [],
    needsClarification = false,
  ) => ({
    error,
    needsClarification,
    doctorId: null,
    doctorName: null,
    clinicServiceId: null,
    serviceName: null,
    serviceKey: null,
    doctors,
    services: services.map(publicService),
    availableServices: catalog.map((service) => service.name),
    doctorChoicesText: doctorChoicesText(doctors),
    availableServicesText: catalog.map((service) => service.name).join(', '),
    serviceChoicesText: services
      .map(
        (service) =>
          `${service.name} | service_key=${service.serviceKey} | clinic_service_id=${service.clinicServiceId}`,
      )
      .join('\n'),
  });
  let service: RoutingService | undefined;
  if (input.clinicServiceId) {
    service = catalog.find((item) => item.clinicServiceId === input.clinicServiceId);
    if (!service) return fail('service_not_found');
  }
  if (input.serviceKey) {
    const byKey = catalog.find((item) => item.serviceKey === input.serviceKey);
    if (!byKey) return fail('service_not_found');
    if (service && service.clinicServiceId !== byKey.clinicServiceId)
      return fail('service_id_key_mismatch', catalog, [], true);
    service = byKey;
  }
  if (!service && input.reasonForVisit) {
    const routedId = await routeReason(input.reasonForVisit);
    service = catalog.find((item) => item.clinicServiceId === routedId);
    if (!service) return fail('service_not_found');
  }
  let requestedDoctors = allDoctors;
  if (input.doctorName) {
    requestedDoctors = allDoctors.filter((doctor) =>
      doctorNameMatches(doctor.doctorName, input.doctorName!),
    );
    if (!requestedDoctors.length)
      return fail('doctor_not_found', service ? [service] : catalog, service?.doctors ?? [], true);
    if (service) {
      requestedDoctors = requestedDoctors.filter((doctor) =>
        service!.doctors.some((candidate) => candidate.doctorId === doctor.doctorId),
      );
      if (!requestedDoctors.length)
        return fail('doctor_service_mismatch', [service], service.doctors, true);
    }
    // Prefer a full-name match over a partial name that also matches longer names.
    const exact = requestedDoctors.filter(
      (doctor) => normalizeDoctorName(doctor.doctorName) === normalizeDoctorName(input.doctorName!),
    );
    if (exact.length) requestedDoctors = exact;
  }
  if (input.doctorId) {
    const byId = requestedDoctors.find((doctor) => doctor.doctorId === input.doctorId);
    if (!byId)
      return fail(
        input.doctorName ? 'doctor_name_id_mismatch' : 'doctor_not_found',
        catalog,
        requestedDoctors,
        Boolean(input.doctorName),
      );
    requestedDoctors = [byId];
  }
  const hasDoctorPreference = Boolean(input.doctorId || input.doctorName);
  if (!service && hasDoctorPreference) {
    const candidates = catalog.filter((item) =>
      item.doctors.some((doctor) =>
        requestedDoctors.some((requested) => requested.doctorId === doctor.doctorId),
      ),
    );
    if (candidates.length !== 1) {
      return fail(
        requestedDoctors.length > 1 ? 'doctor_ambiguous' : 'service_required_for_doctor',
        candidates,
        requestedDoctors,
        true,
      );
    }
    service = candidates[0];
  }
  if (!service) return fail('reason_or_service_key_required');
  const eligibleDoctors = service.doctors.filter(
    (doctor) =>
      !hasDoctorPreference ||
      requestedDoctors.some((requested) => requested.doctorId === doctor.doctorId),
  );
  if (!eligibleDoctors.length)
    return fail(
      hasDoctorPreference ? 'doctor_service_mismatch' : 'no_service_for_doctor',
      [service],
      service.doctors,
      hasDoctorPreference,
    );
  if (hasDoctorPreference && eligibleDoctors.length > 1)
    return fail('doctor_ambiguous', [service], eligibleDoctors, true);
  const doctor = hasDoctorPreference ? eligibleDoctors[0]! : null;
  return {
    doctorId: doctor?.doctorId ?? null,
    doctorName: doctor?.doctorName ?? null,
    clinicServiceId: service.clinicServiceId,
    serviceName: service.name,
    serviceKey: service.serviceKey,
    doctors: service.doctors,
    doctorChoicesText: doctorChoicesText(service.doctors),
    availableServicesText: catalog.map((item) => item.name).join(', '),
    serviceChoicesText: `${service.name} | service_key=${service.serviceKey} | clinic_service_id=${service.clinicServiceId}`,
    needsClarification: false,
    doctorSelection: hasDoctorPreference
      ? ('requested' as const)
      : ('pending_availability' as const),
  };
}
