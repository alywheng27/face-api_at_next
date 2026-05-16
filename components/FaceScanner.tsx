"use client";
/**
 * components/FaceScanner.tsx
 *
 * PURPOSE:
 * The main scanning component. Opens the webcam, runs face detection on a
 * 2-second interval, compares detected descriptors against all enrolled
 * people from the database, and displays a result card on match.
 *
 * HOW FACE MATCHING WORKS (step by step):
 *
 *  1. On mount → fetch GET /api/descriptors (all enrolled people's 128-float arrays)
 *  2. Build a face-api.js FaceMatcher from those labeled descriptors
 *  3. Every 2 seconds → draw a video frame, run detectSingleFace()
 *  4. detectSingleFace returns a descriptor (128 floats) for whoever is in frame
 *  5. FaceMatcher.findBestMatch() compares that descriptor against all known ones
 *     using Euclidean distance. Lower distance = better match.
 *  6. If distance < threshold (0.5), it's a match → fetch full info from /api/person/[id]
 *  7. Display the result card. If distance ≥ threshold → "Unknown"
 *
 * DISTANCE THRESHOLD:
 *  0.4 = very strict (fewer false positives, more false negatives)
 *  0.5 = balanced (recommended starting point)
 *  0.6 = lenient (more matches, higher risk of wrong person)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { recordAttendance } from "@/actions/attendance";
import { getFaceApi, loadModels } from "@/lib/faceapi";
import type { AttendanceOutcome, DescriptorRecord, Person } from "@/types";

// const SCAN_INTERVAL_MS = 2000; // how often to scan (milliseconds)
const SCAN_INTERVAL_MS = 200; // how often to scan (milliseconds)
const MATCH_THRESHOLD = 0.5; // Euclidean distance threshold

type Status = "loading-models" | "loading-descriptors" | "ready" | "error";

// One entry in the results sidebar — either a matched person or an unknown face
interface FaceResult {
  label: string;
  confidence: number;
  person: Omit<Person, "face_descriptor"> | null;
  attendance: AttendanceOutcome | null; // null = unknown face, no attendance
}

// Tracks attendance state per person in the current session
interface AttendanceState {
  morningDone: boolean;
  afternoonDone: boolean;
  lastOutcome: AttendanceOutcome | null;
}

export default function FaceScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matcherRef = useRef<import("face-api.js").FaceMatcher | null>(null);
  const scanningRef = useRef(false); // prevents overlapping scans
  // Caches: person data + attendance state, keyed by DB person id (string)
  const personCacheRef = useRef<Map<string, Omit<Person, "face_descriptor">>>(
    new Map(),
  );
  const attendanceStateRef = useRef<Map<string, AttendanceState>>(new Map());
  // Tracks in-flight attendance calls to prevent concurrent duplicates
  const attendancePendingRef = useRef<Set<string>>(new Set());

  const [status, setStatus] = useState<Status>("loading-models");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [enrolledCount, setEnrolledCount] = useState(0);

  const [faceResults, setFaceResults] = useState<FaceResult[]>([]);

  // ─── Step 1: Load models and build FaceMatcher ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Load the three face-api.js neural network models from /public/models/
        setStatus("loading-models");
        const faceapi = await loadModels();

        if (cancelled) return;

        // Fetch all enrolled descriptors from MSSQL via our API
        setStatus("loading-descriptors");
        const res = await fetch("/api/descriptors");
        if (!res.ok) throw new Error("Failed to fetch descriptors");

        const people: DescriptorRecord[] = await res.json();
        setEnrolledCount(people.length);

        if (people.length === 0) {
          setErrorMsg("No enrolled people found. Please enroll faces first.");
          setStatus("error");
          return;
        }

        // Build labeled descriptors — each person gets a LabeledFaceDescriptors
        // where the label is their DB id (as string) and the descriptor is a Float32Array
        const labeledDescriptors = people.map(
          (p) =>
            new faceapi.LabeledFaceDescriptors(String(p.id), [
              new Float32Array(p.descriptor),
            ]),
        );

        // FaceMatcher holds all known faces and can compare against a new descriptor
        matcherRef.current = new faceapi.FaceMatcher(
          labeledDescriptors,
          MATCH_THRESHOLD,
        );

        // Start webcam
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (!canvasRef.current) return;
        const videoEl = videoRef.current;
        if (!videoEl) return;
        canvasRef.current.style.left = `${videoEl.offsetLeft}px`;
        canvasRef.current.style.top = `${videoEl.offsetTop}px`;
        canvasRef.current.height = videoEl.videoHeight;
        canvasRef.current.width = videoEl.videoWidth;

        setStatus("ready");
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : "Initialization failed",
          );
          setStatus("error");
        }
      }
    }

    init();

    // Cleanup: stop camera when component unmounts
    return () => {
      cancelled = true;
      const video = videoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach((t) => {
          t.stop();
        });
      }
    };
  }, []);

  // ── Record attendance for a matched person (non-blocking) ────────────────────
  // Called during the scan loop. Returns the updated AttendanceState.
  const handleAttendance = useCallback(
    async (personId: string): Promise<AttendanceState> => {
      const existing = attendanceStateRef.current.get(personId);

      // Fast-path: if both sessions are already done, skip the Server Action entirely
      if (existing?.morningDone && existing?.afternoonDone) {
        return existing;
      }

      // Prevent concurrent calls for the same person (can happen at 200ms intervals)
      if (attendancePendingRef.current.has(personId)) {
        return (
          existing ?? {
            morningDone: false,
            afternoonDone: false,
            lastOutcome: null,
          }
        );
      }

      attendancePendingRef.current.add(personId);

      try {
        const outcome = await recordAttendance(Number(personId));

        const prev = attendanceStateRef.current.get(personId) ?? {
          morningDone: false,
          afternoonDone: false,
          lastOutcome: null,
        };

        const next: AttendanceState = {
          morningDone: prev.morningDone || outcome === "morning-recorded",
          afternoonDone: prev.afternoonDone || outcome === "afternoon-recorded",
          lastOutcome: outcome,
        };

        // "already-complete" means both are done
        if (outcome === "already-complete") {
          next.morningDone = true;
          next.afternoonDone = true;
        }

        // "not-morning-yet" means both are done
        if (outcome === "not-morning-yet") {
          next.morningDone = false;
          next.afternoonDone = true;
        }

        attendanceStateRef.current.set(personId, next);
        return next;
      } catch (err) {
        console.error(`Attendance error for person ${personId}:`, err);
        return (
          existing ?? {
            morningDone: false,
            afternoonDone: false,
            lastOutcome: null,
          }
        );
      } finally {
        attendancePendingRef.current.delete(personId);
      }
    },
    [],
  );

  // ─── Step 2: Scan loop ───────────────────────────────────────────────────────
  const scan = useCallback(async () => {
    // Guard: skip if not ready, no matcher, or already scanning
    if (
      status !== "ready" ||
      !matcherRef.current ||
      !videoRef.current ||
      !canvasRef.current ||
      scanningRef.current
    )
      return;

    scanningRef.current = true;

    try {
      const faceapi = getFaceApi();

      // Detect a single face and compute its descriptor
      let detection = await faceapi
        .detectAllFaces(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (!detection) {
        // No face in frame — clear the result
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw bounding box
      const displaySize = {
        width: canvas.width,
        height: canvas.height,
      };

      detection = faceapi.resizeResults(detection, displaySize);
      faceapi.draw.drawDetections(canvas, detection);
      faceapi.draw.drawFaceLandmarks(canvas, detection);

      // Compare the detected descriptor against all enrolled faces
      const matches = detection.map((d) =>
        matcherRef.current!.findBestMatch(d.descriptor),
      );

      // Fetch person data only for matched faces we haven't cached yet
      const uncachedIds = matches
        .map((m) => m.label)
        .filter(
          (label) => label !== "unknown" && !personCacheRef.current.has(label),
        );

      // Deduplicate (same person could appear twice in the same frame)
      const uniqueUncached = [...new Set(uncachedIds)];

      await Promise.all(
        uniqueUncached.map(async (id) => {
          try {
            const r = await fetch(`/api/person/${id}`);
            if (!r.ok) return;
            const person: Omit<Person, "face_descriptor"> = await r.json();
            personCacheRef.current.set(id, person);
          } catch {
            // Silently skip fetch errors — the face will show as unknown
          }
        }),
      );

      // Record attendance + build results in parallel for all matched faces
      const matchedIds = [
        ...new Set(matches.map((m) => m.label).filter((l) => l !== "unknown")),
      ];

      // Fire attendance recording for all matched people simultaneously
      const attendanceResults = await Promise.all(
        matchedIds.map((id) => handleAttendance(id)),
      );
      const attendanceMap = new Map(
        matchedIds.map((id, i) => [id, attendanceResults[i]]),
      );

      // ── Build results array and draw labels on canvas ───────────────────────
      const results: FaceResult[] = [];

      detection.forEach((det, i) => {
        const match = matches[i];
        const isUnknown = match.label === "unknown";
        const person = isUnknown
          ? null
          : (personCacheRef.current.get(match.label) ?? null);
        const attendance = isUnknown
          ? null
          : (attendanceMap.get(match.label)?.lastOutcome ?? null);
        const confidence = Math.round((1 - match.distance) * 100);

        results.push({ label: match.label, confidence, person, attendance });

        // Draw name label above each bounding box
        const box = det.detection.box.topRight;
        const labelText = person ? person.name : "Unknown";
        const confText = `${confidence}%`;
        const padding = 6;
        const fontSize = 13;

        ctx.font = `600 ${fontSize}px "IBM Plex Mono", monospace`;
        const nameWidth = ctx.measureText(labelText).width;
        const confWidth = ctx.measureText(confText).width;
        const bgWidth = Math.max(nameWidth, confWidth) + padding * 2;
        const bgHeight = fontSize * 2 + padding * 3;
        const bgX = box.x;
        const bgY = box.y;
        // const bgY        = box.y - bgHeight - 4;

        // Label background
        ctx.fillStyle = isUnknown
          ? "rgba(245,158,11,0.85)"
          : "rgba(34,197,94,0.85)";
        ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

        // Name text
        ctx.fillStyle = "#000";
        ctx.fillText(labelText, bgX + padding, bgY + padding + fontSize);

        // Confidence text
        ctx.font = `400 ${fontSize - 1}px "IBM Plex Mono", monospace`;
        ctx.fillStyle = isUnknown ? "#000" : "#003300";
        ctx.fillText(
          confText,
          bgX + padding,
          bgY + padding * 2 + fontSize * 2 - 2,
        );
      });

      setFaceResults(results);
    } catch (err) {
      console.error("Scan error:", err);
    } finally {
      scanningRef.current = false;
    }
  }, [status, handleAttendance]);

  const handleVideoMetadata = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Set canvas internal resolution to match the camera stream
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }, []);

  // Run the scan on an interval
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(scan, SCAN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, scan]);

  // Separate matched and unknown for the sidebar
  const matchedFaces = faceResults.filter((r) => r.person !== null);
  const unknownCount = faceResults.filter((r) => r.person === null).length;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="scanner-wrapper">
      {/* Status overlays */}
      {status === "loading-models" && (
        <div className="status-overlay">
          <div className="spinner" />
          <p>Loading AI models…</p>
          <span className="status-hint">Downloading from /public/models/</span>
        </div>
      )}
      {status === "loading-descriptors" && (
        <div className="status-overlay">
          <div className="spinner" />
          <p>Loading enrolled faces…</p>
        </div>
      )}
      {status === "error" && (
        <div className="status-overlay error">
          <span className="error-icon">⚠</span>
          <p>{errorMsg}</p>
        </div>
      )}

      {/* Camera feed */}
      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={handleVideoMetadata}
          className="camera-feed"
        />
        {/* Hidden canvas used to draw frames for processing */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0 /* stretches to fill .video-container exactly */,
            width: "100%",
            height: "100%",
            // transform: "scaleX(-1)" /* ← mirrors to match the video */,
            pointerEvents: "none",
            border: "1px solid red",
          }}
          // style={{ display: "none" }}
        />

        {/* Live scan indicator */}
        {status === "ready" && (
          <div className="scan-indicator">
            <span className="pulse-dot" />
            SCANNING · {enrolledCount} enrolled
          </div>
        )}

        {/* Face detection frame overlay */}
        {/* {status === "ready" && result && (
          <div
            className={`face-frame ${result.found ? "matched" : "unknown"}`}
          />
        )} */}

        {/* Live face count badge */}
        {faceResults.length > 0 && (
          <div className="face-count-badge">
            {faceResults.length} face{faceResults.length !== 1 ? "s" : ""}{" "}
            detected
          </div>
        )}
      </div>

      <div className="results-panel">
        {/* No faces in frame */}
        {status === "ready" && faceResults.length === 0 && (
          <div className="results-empty">
            <span className="results-empty-icon">◎</span>
            <p>No faces in frame</p>
            <span>Point the camera at people to identify them</span>
          </div>
        )}

        {/* Matched people cards */}
        {matchedFaces.map((r, i) => {
          const attState = attendanceStateRef.current.get(r.label);

          return (
            <div key={`${r.label}-${i}`} className="result-card">
              <div className="result-header">
                <div className="avatar">
                  {r.person!.name.charAt(0).toUpperCase()}
                </div>
                <div className="result-info">
                  <h2 className="result-name">{r.person!.name}</h2>
                  {r.person!.position && (
                    <p className="result-position">{r.person!.position}</p>
                  )}
                  {r.person!.department && (
                    <p className="result-department">{r.person!.department}</p>
                  )}
                </div>
              </div>

              {/* Attendance badges */}
              <div className="attendance-badges">
                <span
                  className={`att-badge ${attState?.morningDone ? "att-done" : "att-pending"}`}
                >
                  {attState?.morningDone ? "☀ Morning ✓" : "☀ Morning —"}
                </span>
                <span
                  className={`att-badge ${attState?.afternoonDone ? "att-done" : "att-pending"}`}
                >
                  {attState?.afternoonDone ? "◑ Afternoon ✓" : "◑ Afternoon —"}
                </span>
              </div>

              {/* Flash message for just-recorded attendance */}
              {(r.attendance === "morning-recorded" ||
                r.attendance === "afternoon-recorded") && (
                <div className="att-flash">
                  ✓{" "}
                  {r.attendance === "morning-recorded"
                    ? "Morning"
                    : "Afternoon"}{" "}
                  attendance recorded
                </div>
              )}

              <div className="result-details">
                {r.person!.email && (
                  <div className="detail-row">
                    <span className="detail-label">Email</span>
                    <span className="detail-value">{r.person!.email}</span>
                  </div>
                )}
                {r.person!.phone && (
                  <div className="detail-row">
                    <span className="detail-label">Phone</span>
                    <span className="detail-value">{r.person!.phone}</span>
                  </div>
                )}
              </div>

              <div className="confidence-bar">
                <div className="confidence-label">
                  Match confidence <strong>{r.confidence}%</strong>
                </div>
                <div className="confidence-track">
                  <div
                    className="confidence-fill"
                    style={{ width: `${r.confidence}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Unknown faces summary — one compact row instead of a card per face */}
        {unknownCount > 0 && (
          <div className="result-card unknown">
            <span className="unknown-icon">?</span>
            <p>
              {unknownCount} unknown face{unknownCount !== 1 ? "s" : ""}{" "}
              detected
            </p>
            <span className="unknown-hint">Not in the enrolled database</span>
          </div>
        )}
      </div>
    </div>
  );
}
