/**
 * app/api/descriptors/route.ts
 *
 * GET /api/descriptors
 *
 * PURPOSE:
 * When the scanner page loads, it needs to know everyone's face descriptor
 * so face-api.js can build a FaceMatcher in the browser.
 *
 * This route queries MSSQL for every person who has been enrolled
 * (i.e., face_descriptor IS NOT NULL), and returns a lightweight array
 * of { id, name, descriptor } objects.
 *
 * We deliberately exclude sensitive columns (email, phone, etc.) from this
 * response — those are only fetched on a confirmed match via /api/person/[id].
 *
 * FLOW:
 *   Browser loads scanner page
 *     → fetches GET /api/descriptors
 *     → receives [{id, name, descriptor: [128 floats]}, ...]
 *     → builds FaceMatcher
 *     → starts scanning camera
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { DescriptorRecord } from "@/types";

export async function GET() {
  try {
    const db = await getDb();

    // Only fetch people who have been enrolled (descriptor is not null/empty)
    const result = await db.request().query<{
      id: number;
      name: string;
      face_descriptor: string; // stored as JSON string in MSSQL
    }>(`
      SELECT id, name, face_descriptor
      FROM people
      WHERE face_descriptor IS NOT NULL
        AND face_descriptor != ''
    `);

    // Parse the JSON string back into a number[] for each person
    const records: DescriptorRecord[] = result.recordset.map((row) => ({
      id: row.id,
      name: row.name,
      descriptor: JSON.parse(row.face_descriptor) as number[],
    }));

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/descriptors error:", error);
    return NextResponse.json(
      { error: "Failed to fetch descriptors" },
      { status: 500 },
    );
  }
}
