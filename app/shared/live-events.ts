/** Payloads shared by server and client (ADR-002 solution design, section 3). */

export interface QueuePatient {
  visitId: string;
  name: string;
  kind: 'booked' | 'walk_in';
  appointmentTime: string | null;
  arrivedAt: string;
  arrivedTime: string;
  waitingMinutes: number;
  formDone: boolean;
  reason: string | null; // staff stream only
  emergency: boolean;
}

export interface QueueUpdated {
  professionalId: string;
  version: number;
  patients: QueuePatient[];
  lateness: number | null;
  started: boolean;
}

interface VisitBase {
  firstName: string;
  clinicName: string;
  clinicAddress: string;
  professional: string;
  date: string;
  time: string | null;
  formDone: boolean;
  checkedInAt: string | null;
  updatedAt: string;
}

/** The visit page's whole state; sent as `estimate.updated`. Contains nothing about other patients. */
export type VisitView =
  | { state: 'not_open'; opensAt: string; opensOn: string }
  | { state: 'ended' }
  | ({ state: 'booked'; checkinOpensAt: string | null } & VisitBase)
  | ({ state: 'not_started' } & VisitBase)
  | ({ state: 'waiting'; from: string; to: string; slip: null | { reason: 'emergency' | 'running_long' } } & VisitBase)
  | ({ state: 'called'; room: string | null; calledAt: string | null } & VisitBase)
  | ({ state: 'missed' } & VisitBase);

export type StaffEvent = { event: 'queue.updated'; data: QueueUpdated } | { event: 'session.locked'; data: Record<string, never> };
export type PatientEvent = { event: 'estimate.updated'; data: VisitView } | { event: 'visit.ended'; data: Record<string, never> };
