/**
 * app/api/people/route.ts
 *
 * GET /api/people
 *
 * PURPOSE:
 * Powers the enrollment page dropdown — lists everyone in the database so an
 * admin can pick who they're enrolling. We show their name and whether they
 * already have a descriptor (enrolled vs. not enrolled yet).
 *
 * FLOW:
 *   Admin opens /enroll page
 *     → page fetches GET /api/people
 *     → dropdown shows all people with enrolled/pending badge
 *     → admin selects a person → looks at camera → clicks "Enroll"
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  try {
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
        -- Cast to bit: 1 if enrolled, 0 if not
        CASE WHEN face_descriptor IS NOT NULL AND face_descriptor != ''
             THEN 1 ELSE 0 END AS enrolled
      FROM people
      ORDER BY name ASC
    `);

    return NextResponse.json(result.recordset);
  } catch (error) {
    console.error("GET /api/people error:", error);
    return NextResponse.json(
      { error: "Failed to fetch people list" },
      { status: 500 },
    );
  }
}
