"use server";
/**
 * actions/attendance.ts
 *
 * Server Action: recordAttendance(peopleId)
 *
 * ─── MORNING / AFTERNOON LOGIC ───────────────────────────────────────────────
 * Server's local time determines the session:
 *   Before 12:00 noon  → morning   (attendedMorning = 1)
 *   12:00 noon onward  → afternoon (attendedAfternoon = 1)
 *
 * Using server time prevents client clock manipulation.
 *
 * ─── DEDUPLICATION ───────────────────────────────────────────────────────────
 * One row per person per day. Flow:
 *   No row today       → INSERT with the correct session column set to 1
 *   Row exists         → check which columns are already set, UPDATE only if needed
 *   Both already set   → return "already-complete" immediately (no DB write)
 *
 * ─── WHY A SERVER ACTION ─────────────────────────────────────────────────────
 * FaceScanner calls this every scan tick (~200ms) for each matched face.
 * The "already-complete" fast-path is just one SELECT — negligible cost.
 * Server Actions avoid the JSON serialisation overhead of a fetch() call.
 */

import sql from "mssql";
import { getDb } from "@/lib/db";
import type { AttendanceOutcome } from "@/types";

const MORNING_CUTOFF_HOUR = 12; // before noon = morning session

function isMorningSession(): boolean {
  return new Date().getHours() < MORNING_CUTOFF_HOUR;
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function recordAttendance(
  peopleId: number,
): Promise<AttendanceOutcome> {
  const db = await getDb();
  const today = todayDateString();
  const morning = isMorningSession();

  // Step 1: Check for existing row today
  const existing = await db
    .request()
    .input("peopleId", sql.BigInt, peopleId)
    .input("date", sql.Date, today)
    .query<{
      id: number;
      attendedMorning: boolean;
      attendedAfternoon: number;
    }>(`
      SELECT id, attendedMorning, attendedAfternoon
      FROM   attendance
      WHERE  peopleId = @peopleId
        AND  date     = @date
    `);

  const row = existing.recordset[0];

  // Step 2: No row yet — INSERT
  if (!row) {
    if (morning) {
      await db
        .request()
        .input("peopleId", sql.BigInt, peopleId)
        .input("date", sql.Date, today)
        .query(`
          INSERT INTO attendance (peopleId, attendedMorning, attendedAfternoon, date)
          VALUES (@peopleId, 1, 0, @date)
        `);
      return "morning-recorded";
    } else {
      await db
        .request()
        .input("peopleId", sql.BigInt, peopleId)
        .input("date", sql.Date, today)
        .query(`
          INSERT INTO attendance (peopleId, attendedMorning, attendedAfternoon, date)
          VALUES (@peopleId, 0, 1, @date)
        `);
      return "afternoon-recorded";
    }
  }

  // Step 3: Row exists — update only the missing session
  const hadMorning = Boolean(row.attendedMorning);
  const hadAfternoon = Boolean(row.attendedAfternoon);

  if (morning) {
    if (hadMorning) return "morning-recorded";
    await db
      .request()
      .input("id", sql.BigInt, row.id)
      .query(`UPDATE attendance SET attendedMorning = 1 WHERE id = @id`);
    return "morning-recorded";
  } else {
    if (hadMorning && hadAfternoon) return "already-complete";
    if (!hadMorning && hadAfternoon) return "not-morning-yet";
    await db
      .request()
      .input("id", sql.BigInt, row.id)
      .query(`UPDATE attendance SET attendedAfternoon = 1 WHERE id = @id`);
    return "afternoon-recorded";
  }
}

// ─── Read helper (used by the API route) ─────────────────────────────────────
export async function getAttendanceByDate(date?: string): Promise<
  {
    id: number;
    peopleId: number;
    name: string;
    attendedMorning: boolean;
    attendedAfternoon: boolean;
    date: string;
  }[]
> {
  const db = await getDb();
  const targetDate = date ?? todayDateString();

  const result = await db
    .request()
    .input("date", sql.Date, targetDate)
    .query(`
      SELECT
        a.id,
        a.peopleId,
        p.name,
        a.attendedMorning,
        a.attendedAfternoon,
        CONVERT(varchar, a.date, 23) AS date
      FROM   attendance a
      JOIN   people     p ON p.id = a.peopleId
      WHERE  a.date = @date
      ORDER  BY p.name ASC
    `);

  return result.recordset.map((row) => ({
    ...row,
    attendedMorning: Boolean(row.attendedMorning),
    attendedAfternoon: Boolean(row.attendedAfternoon),
  }));
}
