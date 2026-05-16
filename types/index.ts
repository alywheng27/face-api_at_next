// ─── Person ───────────────────────────────────────────────────────────────────
// Represents a row from your `people` table in MSSQL.
// Add or remove fields here to match YOUR actual table columns.
export interface Person {
  id: number;
  name: string;
  email?: string;
  department?: string;
  position?: string;
  phone?: string;
  // face_descriptor is stored as a JSON string in MSSQL,
  // but we parse it into a number[] when we read it.
  face_descriptor?: number[] | null;
}

// ─── Scan Result ──────────────────────────────────────────────────────────────
// What the scanner returns after trying to identify a face.
export interface ScanResult {
  found: boolean;
  person?: Omit<Person, "face_descriptor">;
  // Euclidean distance between face descriptors (0 = perfect match, 1 = no match)
  distance?: number;
  // Human-readable confidence: (1 - distance) * 100
  confidence?: number;
}

// ─── Descriptor Record ────────────────────────────────────────────────────────
// Lightweight object returned by GET /api/descriptors.
// We only send id + name + descriptor to the client (not all DB columns).
export interface DescriptorRecord {
  id: number;
  name: string;
  descriptor: number[];
}

// ─── Enroll Request Body ──────────────────────────────────────────────────────
export interface EnrollRequestBody {
  personId: number;
  descriptor: number[]; // 128-element float array from face-api.js
}

// ─── Person Option ────────────────────────────────────────────────────────────
// Lightweight person record used in the enroll page dropdown.
// Returned by getPeople() Server Action and GET /api/people API route.
export interface PersonOption {
  id: number;
  name: string;
  department: string | null;
  enrolled: boolean;
}

// ─── Folder Enroll Result ─────────────────────────────────────────────────────
// One result entry from the folder scan enrollment.
// Returned per image file by enrollFromFolder() Server Action
// and POST /api/enroll-from-folder API route.
export interface FolderEnrollResult {
  file: string;
  status: "enrolled" | "no_face" | "no_match" | "error";
  personName?: string;
  error?: string;
}

// ─── Attendance Record ────────────────────────────────────────────────────────
// Mirrors the attendance table schema exactly:
//   id               bigint  PK
//   peopleId         bigint  FK → people.id
//   attendedMorning  bit     1 = attended morning session, 0/NULL = did not
//   attendedAfternoon bigint  treated as bit: 1 = attended afternoon, 0/NULL = did not
//   date             date    the calendar date of attendance
export interface AttendanceRecord {
  id: number;
  peopleId: number;
  attendedMorning: boolean;
  attendedAfternoon: boolean;
  date: string; // ISO date string "YYYY-MM-DD"
}

// ─── Record Attendance Result ─────────────────────────────────────────────────
// Returned by recordAttendance() Server Action to tell the client what happened.
export type AttendanceOutcome =
  | "morning-recorded" // first time this person is seen today (morning)
  | "afternoon-recorded" // person already had morning, now recording afternoon
  | "already-complete" // both sessions already recorded today — nothing to do
  | "not-morning-yet"; // person is seen in the afternoon but has no morning record

// ─── Attendance Status (client-side) ─────────────────────────────────────────
// Stored in FaceScanner's personCacheRef alongside person data.
// Tracks today's recorded status so the UI can show a badge without re-fetching.
export interface PersonAttendanceState {
  morningRecorded: boolean;
  afternoonRecorded: boolean;
  lastOutcome: AttendanceOutcome | null;
}
