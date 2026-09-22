import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DoctorManagement } from '@/components/pages/clinic-setup/DoctorManagement';
import {
  createDoctor,
  createDoctorService,
  createService,
  deleteDoctor,
  fetchDoctorServices,
  fetchDoctors,
  fetchServices,
  patchDoctorService,
  patchService,
} from '@/lib/api/clinic-clinical';

const CLINIC_ID = '00000000-0000-0000-0000-000000000001';
const DOCTOR_ID = '00000000-0000-0000-0000-000000000201';
const GENERAL_SERVICE_ID = '00000000-0000-0000-0000-000000000301';
const DERMATOLOGY_SERVICE_ID = '00000000-0000-0000-0000-000000000302';
const MAPPING_ID = '00000000-0000-0000-0000-000000000401';

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({ effectiveRole: 'admin' }),
}));

vi.mock('@/hooks/useActiveClinicId', () => ({
  useActiveClinicId: () => CLINIC_ID,
}));

vi.mock('@/lib/api/clinic-clinical', () => ({
  createDoctor: vi.fn(),
  createDoctorService: vi.fn(),
  createService: vi.fn(),
  deleteDoctor: vi.fn(),
  fetchDoctorServices: vi.fn(),
  fetchDoctors: vi.fn(),
  fetchServices: vi.fn(),
  patchDoctorService: vi.fn(),
  patchService: vi.fn(),
}));

const mockedCreateDoctor = vi.mocked(createDoctor);
const mockedCreateDoctorService = vi.mocked(createDoctorService);
const mockedCreateService = vi.mocked(createService);
const mockedDeleteDoctor = vi.mocked(deleteDoctor);
const mockedFetchDoctorServices = vi.mocked(fetchDoctorServices);
const mockedFetchDoctors = vi.mocked(fetchDoctors);
const mockedFetchServices = vi.mocked(fetchServices);
const mockedPatchDoctorService = vi.mocked(patchDoctorService);
const mockedPatchService = vi.mocked(patchService);

const predefinedLabels = [
  'Orthopaedic Consultation',
  'Paediatric Consultation',
  'General Consultation',
  'Dermatology Consultation',
  'ENT Consultation',
  'Dental Consultation',
  'Cardiology Consultation',
  'Ophthalmology Consultation',
  'Gynaecology Consultation',
  'Neurology Consultation',
  'Gastroenterology Consultation',
];

beforeEach(() => {
  mockedFetchDoctors.mockReset().mockResolvedValue([
    {
      id: DOCTOR_ID,
      name: 'Dr. Merp',
      qualification: 'MD',
      user_id: null,
      active: true,
    },
  ]);
  mockedFetchServices.mockReset().mockResolvedValue([
    {
      id: GENERAL_SERVICE_ID,
      service_key: 'general_consultation',
      service_name: 'General Consultation',
      active: true,
    },
  ]);
  mockedFetchDoctorServices.mockReset().mockResolvedValue([
    {
      id: MAPPING_ID,
      doctor_id: DOCTOR_ID,
      clinic_service_id: GENERAL_SERVICE_ID,
      consultation_fee_amount: '500.00',
      active: true,
    },
  ]);
  mockedCreateDoctor.mockReset().mockResolvedValue({
    id: '00000000-0000-0000-0000-000000000202',
    name: 'Dr. New',
    qualification: 'MD',
    user_id: null,
    active: true,
  });
  mockedCreateService.mockReset().mockResolvedValue({
    id: DERMATOLOGY_SERVICE_ID,
    service_key: 'dermatology_consultation',
    service_name: 'Dermatology Consultation',
    active: true,
  });
  mockedCreateDoctorService.mockReset().mockResolvedValue({
    id: '00000000-0000-0000-0000-000000000402',
    doctor_id: DOCTOR_ID,
    clinic_service_id: DERMATOLOGY_SERVICE_ID,
    consultation_fee_amount: '500.00',
    active: true,
  });
  mockedDeleteDoctor.mockReset().mockResolvedValue(undefined);
  mockedPatchDoctorService.mockReset().mockResolvedValue({
    id: MAPPING_ID,
    doctor_id: DOCTOR_ID,
    clinic_service_id: GENERAL_SERVICE_ID,
    consultation_fee_amount: '500.00',
    active: false,
  });
  mockedPatchService.mockReset().mockResolvedValue({
    id: GENERAL_SERVICE_ID,
    service_key: 'general_consultation',
    service_name: 'General Consultation',
    active: true,
  });
});

afterEach(() => {
  cleanup();
});

describe('DoctorManagement predefined services', () => {
  it('shows the service with each doctor and removes the separate Services section', async () => {
    render(<DoctorManagement />);

    expect(await screen.findByText('Dr. Merp')).toBeInTheDocument();
    expect(screen.getByText('Service: General Consultation')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add service' })).not.toBeInTheDocument();
  });

  it('offers exactly the predefined readable values in the doctor service dropdown', async () => {
    render(<DoctorManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const serviceSelect = screen.getByRole('combobox', { name: 'Service for Dr. Merp' });
    const options = within(serviceSelect).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Select service',
      ...predefinedLabels,
    ]);
    expect(options.every((option) => !option.textContent?.includes('_'))).toBe(true);
    expect(screen.queryByPlaceholderText('Service name')).not.toBeInTheDocument();
  });

  it('creates a selected missing service with its exact key and name before mapping a doctor', async () => {
    mockedFetchDoctors.mockReset().mockResolvedValue([]);
    mockedFetchServices.mockReset().mockResolvedValue([]);
    mockedFetchDoctorServices.mockReset().mockResolvedValue([]);

    render(<DoctorManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add doctor' }));

    fireEvent.change(screen.getByLabelText('Doctor name'), { target: { value: 'Dr. New' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Service for Dr. New' }), {
      target: { value: 'dermatology_consultation' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Fee for Dr. New' }), {
      target: { value: '750' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedCreateService).toHaveBeenCalledWith(CLINIC_ID, {
        service_key: 'dermatology_consultation',
        service_name: 'Dermatology Consultation',
        active: true,
      });
    });
    expect(mockedCreateDoctorService).toHaveBeenCalledWith(CLINIC_ID, {
      doctor_id: '00000000-0000-0000-0000-000000000202',
      clinic_service_id: DERMATOLOGY_SERVICE_ID,
      consultation_fee_amount: 750,
      active: true,
    });
  });

  it('creates one clinic service when two doctors select the same missing predefined key', async () => {
    mockedFetchDoctors.mockReset().mockResolvedValue([]);
    mockedFetchServices.mockReset().mockResolvedValue([]);
    mockedFetchDoctorServices.mockReset().mockResolvedValue([]);
    mockedCreateDoctor
      .mockReset()
      .mockResolvedValueOnce({
        id: '00000000-0000-0000-0000-000000000202',
        name: 'Dr. One',
        qualification: null,
        user_id: null,
        active: true,
      })
      .mockResolvedValueOnce({
        id: '00000000-0000-0000-0000-000000000203',
        name: 'Dr. Two',
        qualification: null,
        user_id: null,
        active: true,
      });

    render(<DoctorManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add doctor' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add doctor' }));

    const nameInputs = screen.getAllByLabelText('Doctor name');
    fireEvent.change(nameInputs[0]!, { target: { value: 'Dr. One' } });
    fireEvent.change(nameInputs[1]!, { target: { value: 'Dr. Two' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Service for Dr. One' }), {
      target: { value: 'dermatology_consultation' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Service for Dr. Two' }), {
      target: { value: 'dermatology_consultation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedCreateDoctorService).toHaveBeenCalledTimes(2);
    });
    expect(mockedCreateService).toHaveBeenCalledTimes(1);
    expect(mockedCreateService).toHaveBeenCalledWith(CLINIC_ID, {
      service_key: 'dermatology_consultation',
      service_name: 'Dermatology Consultation',
      active: true,
    });
  });

  it('reuses an existing service key and disables the doctor previous active mapping', async () => {
    mockedFetchServices.mockReset().mockResolvedValue([
      {
        id: GENERAL_SERVICE_ID,
        service_key: 'general_consultation',
        service_name: 'General Consultation',
        active: true,
      },
      {
        id: DERMATOLOGY_SERVICE_ID,
        service_key: 'dermatology_consultation',
        service_name: 'Dermatology Consultation',
        active: true,
      },
    ]);

    render(<DoctorManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Service for Dr. Merp' }), {
      target: { value: 'dermatology_consultation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedCreateDoctorService).toHaveBeenCalledWith(CLINIC_ID, {
        doctor_id: DOCTOR_ID,
        clinic_service_id: DERMATOLOGY_SERVICE_ID,
        consultation_fee_amount: 500,
        active: true,
      });
    });
    expect(mockedCreateService).not.toHaveBeenCalled();
    expect(mockedPatchDoctorService).toHaveBeenCalledWith(CLINIC_ID, MAPPING_ID, {
      active: false,
    });
    expect(mockedPatchService).toHaveBeenCalledWith(CLINIC_ID, GENERAL_SERVICE_ID, {
      active: false,
    });
  });
});
