import { apiGet, apiPost } from './client';

export type SlotUpdateStatus = {
  state: 'ready' | 'updating' | 'failed';
  remaining: number;
  failed: number;
};

export function fetchSlotUpdateStatus(clinicId: string, doctorId: string, signal?: AbortSignal) {
  return apiGet<SlotUpdateStatus>(
    `/v1/clinics/${clinicId}/slot-reconciliation/status?doctor_id=${encodeURIComponent(doctorId)}`,
    signal,
  );
}

export function retrySlotUpdates(clinicId: string) {
  return apiPost<SlotUpdateStatus>(`/v1/clinics/${clinicId}/slot-reconciliation/retry`, {});
}
