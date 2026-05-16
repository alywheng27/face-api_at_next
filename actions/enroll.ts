"use server";
/**
 * actions/enroll.ts
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────
 * Previously, the enroll page had to do three round-trips over HTTP:
 *
 *   1. fetch("/api/people")              → load the dropdown
 *   2. fetch("/api/enroll", POST)        → save a descriptor from camera/upload
 *   3. fetch("/api/enroll-from-folder")  → trigger bulk folder enrollment
 *
 * Server Actions replace #1, #2, and #3 with direct function calls.
 * The "use server" directive at the top tells Next.js to keep every function
 * in this file on the server — they never ship to the browser bundle.
 * The client calls them as if they were normal async functions, but Next.js
 * serialises the call over a secure POST request under the hood.
 *
 * The three original API routes (api/people, api/enroll, api/enroll-from-folder)
 * are intentionally kept as HTTP endpoints for third-party access. These Server
 * Actions are the internal equivalent used by our own UI.
 *
 * ─── ACTIONS IN THIS FILE ────────────────────────────────────────────────────
 *
 *  getPeople()    → replaces fetch("/api/people") in useEffect
 *  saveDescriptor() → replaces fetch("/api/enroll", POST)
 *  getPeopleIds()   → provides DB ids to the client-side folder scan
 */

import sql from "mssql";
import { getDb } from "@/lib/db";
import type { PersonOption } from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 1 — getPeople
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fetches all people from MSSQL with their enrollment status.
 *
 * BEFORE: EnrollPerson.tsx called fetch("/api/people") inside useEffect,
 *         which meant the dropdown was empty on first render and only filled
 *         after a client-side fetch completed.
 *
 * AFTER:  The enroll page (Server Component) calls getPeople() at render time
 *         on the server and passes the result as a prop to EnrollPerson.
 *         The dropdown is pre-populated — no loading state needed.
 *
 * Called from: app/enroll/page.tsx (server component, at render time)
 */
export async function getPeople(): Promise<PersonOption[]> {
  const db = await getDb();

  const result = await db.request().query<{
    id: number;
    name: string;
    department: string | null;
    enrolled: boolean;
  }>(`
    SELECT
      id,
      name,
      CASE WHEN face_descriptor IS NOT NULL AND face_descriptor != ''
           THEN 1 ELSE 0 END AS enrolled
    FROM people
    ORDER BY name ASC
  `);

  return result.recordset;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 2 — saveDescriptor
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Saves a 128-float face descriptor to MSSQL for a given person.
 *
 * BEFORE: EnrollPerson.tsx called fetch("/api/enroll", { method: "POST", body: ... })
 *         which required manually serialising the body and reading the JSON response.
 *
 * AFTER:  EnrollPerson.tsx calls saveDescriptor(personId, descriptor) directly.
 *         It's a typed function call — no JSON.stringify, no fetch, no response.json().
 *         Next.js handles the serialisation internally.
 *
 * Called from: components/EnrollPerson.tsx (client component, on capture/upload)
 *
 * Returns: { success: true } on success, throws an Error on failure.
 *          The client catches the error and shows it in the UI.
 */
export async function saveDescriptor(
  personId: number,
  descriptor: number[],
): Promise<{ success: true }> {
  // Validation — same rules as the API route
  if (!personId || !descriptor || descriptor.length !== 128) {
    throw new Error("personId and a 128-element descriptor array are required");
  }

  const db = await getDb();
  const descriptorJson = JSON.stringify(descriptor);

  const result = await db
    .request()
    .input("id", sql.Int, personId)
    .input("descriptor", sql.NVarChar(sql.MAX), descriptorJson)
    .query(`
      UPDATE people
      SET face_descriptor = @descriptor
      WHERE id = @id
    `);

  if (result.rowsAffected[0] === 0) {
    throw new Error(`No person found with id ${personId}`);
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION 3 — getPeopleIds
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns all person IDs and names from the DB.
 *
 * Used by the client-side folder scan to know which IDs to look for.
 * The client picks a local folder via showDirectoryPicker(), checks which
 * files match an ID (e.g. "42.jpg" → id 42), runs face-api.js in the browser
 * to generate descriptors, then calls saveDescriptor() for each match.
 *
 * This replaces the old enrollFromFolder() Server Action which required
 * @tensorflow/tfjs-node and canvas (native packages, hard to install on Windows).
 * All face detection now happens in the browser — no native packages needed.
 *
 * Called from: components/EnrollPerson.tsx (folder scan tab, on mount/scan start)
 */
export async function getPeopleIds(): Promise<{ id: number; name: string }[]> {
  const db = await getDb();
  const result = await db
    .request()
    .query<{ id: number; name: string }>(
      "SELECT id, name FROM people ORDER BY id ASC",
    );
  return result.recordset;
}
