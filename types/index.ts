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
