/**
 * app/api/person/[id]/route.ts
 *
 * GET /api/person/:id
 *
 * PURPOSE:
 * After the scanner finds a face match, it only has the person's database ID
 * (used as the label in FaceMatcher). This route fetches the full person record
 * so we can display their name, department, email, etc.
 *
 * WHY NOT INCLUDE EVERYTHING IN /api/descriptors?
 * Keeping descriptors lean (id + name + descriptor only) means we send less
 * data on page load. Full details are fetched on-demand, only when a face
 * is actually recognized.
 *
 * FLOW:
 *   FaceMatcher returns best match with label = "42" (person's DB id)
 *     → browser fetches GET /api/person/42
 *     → this route queries MSSQL: SELECT * FROM people WHERE id = 42
 *     → returns { id, name, email, department, position, phone }
 *     → browser displays the result card
 */

import sql from "mssql";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Person } from "@/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const obj = await params;
  try {
    const personId = parseInt(obj.id, 10);

    if (isNaN(personId)) {
      return NextResponse.json({ error: "Invalid person ID" }, { status: 400 });
    }

    const db = await getDb();

    // ⚠️ Adjust the SELECT columns to match YOUR actual table schema.
    // Remove columns you don't have; add ones you do.
    const result = await db
      .request()
      .input("id", sql.Int, personId)
      .query<Person>(`
        SELECT
          id,
          name
        FROM people
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    // Return person data but strip out face_descriptor
    // (no need to send the descriptor back to the client)
    const { face_descriptor: _, ...person } = result.recordset[0] as Person;

    return NextResponse.json(person);
  } catch (error) {
    console.error("GET /api/person/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch person" },
      { status: 500 },
    );
  }
}
