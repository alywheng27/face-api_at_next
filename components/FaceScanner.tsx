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
import { getFaceApi, loadModels } from "@/lib/faceapi";
import type { DescriptorRecord, ScanResult } from "@/types";

const SCAN_INTERVAL_MS = 2000; // how often to scan (milliseconds)
const MATCH_THRESHOLD = 0.5; // Euclidean distance threshold

type Status = "loading-models" | "loading-descriptors" | "ready" | "error";

export default function FaceScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matcherRef = useRef<import("face-api.js").FaceMatcher | null>(null);
  const scanningRef = useRef(false); // prevents overlapping scans

  const [status, setStatus] = useState<Status>("loading-models");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [enrolledCount, setEnrolledCount] = useState(0);

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
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

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
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

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
      const detection = await faceapi
        .detectSingleFace(
          videoRef.current,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        // No face in frame — clear the result
        setResult(null);
        return;
      }

      // Compare the detected descriptor against all enrolled faces
      const match = matcherRef.current.findBestMatch(detection.descriptor);

      if (match.label === "unknown") {
        setResult({ found: false });
        return;
      }

      // We have a match — fetch the full person record from MSSQL
      const personRes = await fetch(`/api/person/${match.label}`);
      if (!personRes.ok) {
        setResult({ found: false });
        return;
      }

      const person = await personRes.json();
      const confidence = Math.round((1 - match.distance) * 100);

      setResult({
        found: true,
        person,
        distance: match.distance,
        confidence,
      });
    } catch (err) {
      console.error("Scan error:", err);
    } finally {
      scanningRef.current = false;
    }
  }, [status]);

  // Run the scan on an interval
  useEffect(() => {
    if (status !== "ready") return;
    const interval = setInterval(scan, SCAN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, scan]);

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
          className="camera-feed"
        />
        {/* Hidden canvas used to draw frames for processing */}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Live scan indicator */}
        {status === "ready" && (
          <div className="scan-indicator">
            <span className="pulse-dot" />
            SCANNING · {enrolledCount} enrolled
          </div>
        )}

        {/* Face detection frame overlay */}
        {status === "ready" && result && (
          <div
            className={`face-frame ${result.found ? "matched" : "unknown"}`}
          />
        )}
      </div>

      {/* Result card */}
      {result?.found && result.person && (
        <div className="result-card">
          <div className="result-header">
            <div className="avatar">
              {result.person.name.charAt(0).toUpperCase()}
            </div>
            <div className="result-info">
              <h2 className="result-name">{result.person.name}</h2>
              {result.person.position && (
                <p className="result-position">{result.person.position}</p>
              )}
              {result.person.department && (
                <p className="result-department">{result.person.department}</p>
              )}
            </div>
          </div>

          <div className="result-details">
            {result.person.email && (
              <div className="detail-row">
                <span className="detail-label">Email</span>
                <span className="detail-value">{result.person.email}</span>
              </div>
            )}
            {result.person.phone && (
              <div className="detail-row">
                <span className="detail-label">Phone</span>
                <span className="detail-value">{result.person.phone}</span>
              </div>
            )}
          </div>

          <div className="confidence-bar">
            <div className="confidence-label">
              Match confidence
              <strong>{result.confidence}%</strong>
            </div>
            <div className="confidence-track">
              <div
                className="confidence-fill"
                style={{ width: `${result.confidence}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {result && !result.found && (
        <div className="result-card unknown">
          <span className="unknown-icon">?</span>
          <p>Face detected — no match in database</p>
        </div>
      )}
    </div>
  );
}
