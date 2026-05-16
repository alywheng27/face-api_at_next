/**
 * app/api/enroll-from-folder/route.ts
 *
 * POST /api/enroll-from-folder
 *
 * ─── PURPOSE ─────────────────────────────────────────────────────────────────
 * Public HTTP endpoint for triggering bulk folder enrollment.
 * Kept for third-party integrations (CI/CD pipelines, admin scripts,
 * or any external system that needs to trigger a bulk re-enrollment).
 *
 * ─── INTERNAL EQUIVALENT ─────────────────────────────────────────────────────
 * Our own UI no longer calls this route. EnrollPerson.tsx calls
 * enrollFromFolder() from actions/enroll.ts directly.
 * This route delegates to that same action — single source of truth.
 *
 * ─── THIRD-PARTY USAGE ───────────────────────────────────────────────────────
 * POST /api/enroll-from-folder
 * No body required.
 * Response: { "success": true, "enrolled": 5, "failed": 1, "results": [...] }
 *
 * FILE NAMING: images in /public/images/people/ must match DB names.
 * "John Doe" → john_doe.jpg / john-doe.png / John Doe.jpg
 * Supported formats: .jpg .jpeg .png .webp
 *
 * REQUIRES: npm install @tensorflow/tfjs-node canvas
 */

import { NextResponse } from "next/server";
import { enrollFromFolder } from "@/actions/enroll";

export async function POST() {
  try {
    // Delegate to the same Server Action used by our own UI — single source of truth
    const result = await enrollFromFolder();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error("POST /api/enroll-from-folder error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Folder enrollment failed",
        hint: "Make sure you ran: npm install @tensorflow/tfjs-node canvas",
      },
      { status: 500 },
    );
  }
}
