import { describe, expect, it } from 'vitest';

import { routeServiceMock, routeServiceFromProfiles } from '@vaidya/shared';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_CLINIC_ID = '00000000-0000-0000-0000-000000000002';

const seedGeneralService = {
  id: '00000000-0000-0000-0000-000000000301',
  serviceKey: 'general_consultation',
  serviceName: 'General Consultation',
  handlesJson: ['fever', 'cold', 'cough', 'headache', 'mild stomach pain', 'vayiru vali'],
  doesNotHandleJson: ['eye checkup', 'tooth pain', 'fracture emergency'],
  redFlagsJson: ['chest pain', 'breathing difficulty', 'severe bleeding'],
  routingExamplesJson: ['Fever irukku', 'Vayiru vali irukku'],
};

const seedPaediatricService = {
  id: '00000000-0000-0000-0000-000000000302',
  serviceKey: 'paediatric_consultation',
  serviceName: 'Paediatric Consultation',
  handlesJson: ['child fever', 'baby fever', 'vaccination'],
  doesNotHandleJson: ['adult fever'],
  redFlagsJson: ['child not breathing', 'fits'],
  routingExamplesJson: ['Kuzhandhaikku fever'],
};

const seedOrthoService = {
  id: '00000000-0000-0000-0000-000000000303',
  serviceKey: 'orthopaedic_consultation',
  serviceName: 'Orthopaedic Consultation',
  handlesJson: ['knee pain', 'leg pain', 'back pain', 'joint pain'],
  doesNotHandleJson: ['chest pain', 'eye checkup'],
  redFlagsJson: ['major accident', 'severe bleeding'],
  routingExamplesJson: ['Knee pain irukku'],
};

const otherClinicDentalService = {
  id: '00000000-0000-0000-0000-000000000402',
  serviceKey: 'dental',
  serviceName: 'Dental',
  handlesJson: ['tooth pain', 'dental extraction'],
  doesNotHandleJson: [],
  redFlagsJson: [],
  routingExamplesJson: ['Tooth pain irukku'],
};

describe('A14 service router capability context and unsupported handling', () => {
  it('1. knee pain maps to ortho when active', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'knee pain',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(true);
    expect(result.serviceKey).toBe('orthopaedic_consultation');
    expect(result.clinicServiceId).toBe(seedOrthoService.id);
  });

  it('2. knee pain unsupported when no ortho and general does_not_handle includes it', () => {
    const generalWithoutOrtho = {
      ...seedGeneralService,
      doesNotHandleJson: [...seedGeneralService.doesNotHandleJson, 'knee pain', 'joint pain'],
    };

    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'knee pain',
      activeClinicServices: [generalWithoutOrtho, seedPaediatricService],
    });

    expect(result.matched).toBe(false);
    expect(result.unsupportedReason).toBe('no_matching_clinic_service');
  });

  it('3. child fever maps paediatric if configured', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'Kuzhandhaikku fever',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(true);
    expect(result.serviceKey).toBe('paediatric_consultation');
  });

  it('4. adult fever maps general if configured', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'Fever irukku',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(true);
    expect(result.serviceKey).toBe('general_consultation');
  });

  it('5. tooth pain unsupported when no dental', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'tooth pain',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(false);
    expect(result.unsupportedReason).toBe('no_matching_clinic_service');
  });

  it('6. eye checkup unsupported when no eye service', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'eye checkup',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(false);
    expect(result.unsupportedReason).toBe('no_matching_clinic_service');
  });

  it('7. chest pain returns emergency path, not general service', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'chest pain',
      activeClinicServices: [seedGeneralService, seedPaediatricService, seedOrthoService],
    });

    expect(result.matched).toBe(false);
    expect(result.unsupportedReason).toBe('red_flag_emergency');
    expect(result.clinicServiceId).toBeUndefined();
  });

  it('8. two close matches return needsClarification', () => {
    const musculoskeletalService = {
      id: '00000000-0000-0000-0000-000000000304',
      serviceKey: 'musculoskeletal_consultation',
      serviceName: 'Musculoskeletal Consultation',
      handlesJson: ['back pain', 'muscle pain'],
      doesNotHandleJson: [],
      redFlagsJson: [],
      routingExamplesJson: ['Back pain irukku'],
    };
    const physiotherapyService = {
      id: '00000000-0000-0000-0000-000000000305',
      serviceKey: 'physiotherapy_consultation',
      serviceName: 'Physiotherapy Consultation',
      handlesJson: ['back pain', 'physiotherapy'],
      doesNotHandleJson: [],
      redFlagsJson: [],
      routingExamplesJson: ['Back pain irukku'],
    };

    const result = routeServiceFromProfiles({
      clinicId: CLINIC_ID,
      reasonForVisit: 'back pain',
      activeClinicServices: [musculoskeletalService, physiotherapyService],
    });

    expect(result.matched).toBe(false);
    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toMatch(/Musculoskeletal|Physiotherapy/i);
  });

  it('9. inactive service is not used', () => {
    const result = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'knee pain',
      activeClinicServices: [seedGeneralService, seedPaediatricService],
    });

    expect(result.matched).toBe(false);
    expect(result.unsupportedReason).toBe('no_matching_clinic_service');
  });

  it('10. other clinic service is not used', () => {
    const clinicA = routeServiceMock({
      clinicId: CLINIC_ID,
      reasonForVisit: 'tooth pain',
      activeClinicServices: [seedGeneralService, seedOrthoService],
    });
    const clinicB = routeServiceMock({
      clinicId: OTHER_CLINIC_ID,
      reasonForVisit: 'tooth pain',
      activeClinicServices: [otherClinicDentalService],
    });

    expect(clinicA.matched).toBe(false);
    expect(clinicB.matched).toBe(true);
    expect(clinicB.serviceKey).toBe('dental');
    expect(clinicB.clinicServiceId).toBe(otherClinicDentalService.id);
  });
});
