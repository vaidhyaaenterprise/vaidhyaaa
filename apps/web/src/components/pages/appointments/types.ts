export type AppointmentStatus = 'pending_confirmation' | 'confirmed' | 'visited' | 'cancelled';
export type AppointmentSource = 'agent' | 'manual' | 'admin';
export type RoutingSource = 'voice_bot' | 'manual_booking' | 'admin_override';
export type VisitType = 'new' | 'follow_up';

export interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  doctorId: string;
  doctorName: string;
  serviceId: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  reasonForVisit: string;
  visitType: VisitType;
  routingSource: RoutingSource;
  source: AppointmentSource;
  status: AppointmentStatus;
  hasHistory: boolean;
  overrideReason?: string;
}

export interface AppointmentActionRequest {
  id: string;
  appointmentId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  serviceId: string;
  serviceName: string;
  requestedDate: string;
  requestedTime: string;
  requestedNewSlotId?: string | null;
  reason: string;
  actionType: 'reschedule' | 'cancel';
  status: 'pending' | 'approved' | 'rejected';
}

export interface BookingRules {
  slotDurationMinutes: number;
  capacityPerSlot: number;
  bookingHorizonDays: number;
  manualEditCutoffBeforeStartMinutes: number;
  manualEditMaxShiftMinutes: number;
  allowDoctorServiceEdit: boolean;
}

export interface PatientHistory {
  id: string;
  patientName: string;
  patientPhone: string;
  previousVisits: PreviousVisit[];
}

export interface PreviousVisit {
  id: string;
  date: string;
  doctorName: string;
  serviceName: string;
  diagnosis?: string;
  notes?: string;
}
