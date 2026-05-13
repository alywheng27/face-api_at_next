"use client";
/**
 * components/EnrollPerson.tsx
 *
 * PURPOSE:
 * Admin-facing component. Lets an admin select a person from the database,
 * look at the camera, and click "Capture" to generate and save their
 * face descriptor.
 *
 * HOW ENROLLMENT WORKS (step by step):
 *
 *  1. Page loads → fetch GET /api/people → populate dropdown
 *  2. Admin selects a person and starts the camera
 *  3. Admin clicks "Capture Face"
 *  4. face-api.js detects the face in the video frame
 *  5. Generates a 128-float descriptor (unique fingerprint of that face)
 *  6. POSTs { personId, descriptor } to POST /api/enroll
 *  7. MSSQL UPDATE sets face_descriptor = JSON.stringify(descriptor)
 *  8. That person can now be recognized by the scanner
 *
 * TIPS FOR GOOD ENROLLMENT:
 *  - Good lighting, face clearly visible
 *  - Look straight at camera
 *  - For better accuracy: enroll multiple times (re-enroll) in different lighting
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFaceApi, loadModels } from "@/lib/faceapi";

interface PersonOption {
  id: number;
  name: string;
  department: string | null;
  enrolled: boolean;
}

type EnrollStatus =
  | "idle"
  | "loading"
  | "camera-ready"
  | "capturing"
  | "success"
  | "error";

export default function EnrollPerson() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [people, setPeople] = useState<PersonOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [status, setStatus] = useState<EnrollStatus>("loading");
  const [message, setMessage] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
  }, []);

  // ─── Load models + people list on mount ────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // Load face-api models in parallel with the people list fetch
        const [_, peopleRes] = await Promise.all([
          loadModels(),
          fetch("/api/people"),
        ]);

        const peopleData: PersonOption[] = await peopleRes.json();
        setPeople(peopleData);
        setModelsLoaded(true);
        setStatus("idle");
      } catch (err) {
        setStatus("error");
        setMessage(
          "Failed to initialize. Check your connection and try again.",
        );
      }
    }
    init();

    // Cleanup camera on unmount
    return () => stopCamera();
  }, [stopCamera]);

  // ─── Camera controls ─────────────────────────────────────────────────────────
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // video: true,
        video: { width: 640, height: 480, facingMode: "user" },
        // video: { width: 1080, height: 720, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // Make the canvas same size and in the same location as the video feed
      if (!canvasRef.current) return;
      const videoEl = videoRef.current;
      if (!videoEl) return;
      canvasRef.current.style.left = `${videoEl.offsetLeft}px`;
      canvasRef.current.style.top = `${videoEl.offsetTop}px`;
      canvasRef.current.height = videoEl.videoHeight;
      canvasRef.current.width = videoEl.videoWidth;

      // Facial detections with points
      setInterval(async () => {
        // get the video feed and give it to detectAllfaces method
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        // Load models
        // Pre-trained machine learning  for facial detection
        const faceapi = getFaceApi();
        let faceAIData = await faceapi
          .detectAllFaces(video)
          .withFaceLandmarks()
          .withFaceDescriptors()
          .withAgeAndGender()
          .withFaceExpressions();
        // console.log(faceAIData);

        // We have ton of good facial detection data in faceAIData
        // faceAIData is an array, one element for each face

        // Draw on our face/canvas
        // First, clear the canvas
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw bounding box
        const displaySize = {
          width: canvas.width,
          height: canvas.height,
        };

        faceAIData = faceapi.resizeResults(faceAIData, displaySize);
        faceapi.draw.drawDetections(canvas, faceAIData);
      }, 200);

      setStatus("camera-ready");
    } catch {
      setStatus("error");
      setMessage("Camera access denied. Please allow camera permissions.");
    }
  }

  const handleVideoMetadata = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Set canvas internal resolution to match the camera stream
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // console.log(canvas.width);
    // console.log(canvas.height);
  }, []);

  // ─── Capture and enroll ───────────────────────────────────────────────────────
  async function capture() {
    if (!selectedId || !videoRef.current) return;
    setStatus("capturing");
    setMessage("");

    try {
      const faceapi = getFaceApi();

      // Try to detect a face in the current video frame
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
        setStatus("camera-ready");
        setMessage(
          "⚠ No face detected. Make sure your face is well-lit and clearly visible.",
        );
        return;
      }

      // Convert Float32Array to a plain number[] for JSON serialization
      const descriptor = Array.from(detection.descriptor);

      // Save to MSSQL via the enroll API route
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: selectedId, descriptor }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Enrollment failed");
      }

      // Update the local list to mark this person as enrolled
      setPeople((prev) =>
        prev.map((p) => (p.id === selectedId ? { ...p, enrolled: true } : p)),
      );

      setStatus("success");
      setMessage("Face enrolled successfully!");
      stopCamera();
    } catch (err: unknown) {
      setStatus("camera-ready");
      setMessage(
        err instanceof Error ? err.message : "Enrollment failed. Try again.",
      );
    }
  }

  function reset() {
    setSelectedId("");
    setStatus("idle");
    setMessage("");
    stopCamera();
  }

  const selectedPerson = people.find((p) => p.id === selectedId);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="enroll-wrapper">
      <div className="enroll-card">
        <h2 className="enroll-title">Enroll a Face</h2>
        <p className="enroll-subtitle">
          Select a person from the database and capture their face to enable
          recognition.
        </p>

        {/* Person selector */}
        <div className="field">
          <label className="field-label" htmlFor="selectPerson">
            Select Person
          </label>
          <select
            className="field-select"
            id="selectPerson"
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value ? Number(e.target.value) : "");
              setStatus("idle");
              setMessage("");
              stopCamera();
            }}
            disabled={status === "capturing" || !modelsLoaded}
          >
            <option value="">— Choose a person —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.department ? ` · ${p.department}` : ""}
                {p.enrolled ? " ✓" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Enrolled badge */}
        {selectedPerson?.enrolled && (
          <div className="enrolled-badge">
            ✓ Already enrolled — capturing again will update their face data
          </div>
        )}

        {/* Camera area */}
        {selectedId !== "" && (
          <div>
            <div className="camera-area">
              <div style={{ position: "relative" }}>
                <video
                  ref={videoRef}
                  // style={{ zIndex: 1, position: "absolute" }}
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={handleVideoMetadata}
                  className={`enroll-video ${status === "camera-ready" || status === "capturing" ? "visible" : "hidden"}`}
                />
                <canvas
                  ref={canvasRef}
                  style={{
                    position: "absolute",
                    inset: 0 /* stretches to fill .video-container exactly */,
                    width: "100%",
                    height: "100%",
                    transform: "scaleX(-1)" /* ← mirrors to match the video */,
                    pointerEvents: "none",
                    border: "1px solid red",
                  }}
                ></canvas>
              </div>

              {status === "idle" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startCamera}
                >
                  Start Camera
                </button>
              )}

              {(status === "camera-ready" || status === "capturing") && (
                <button
                  type="button"
                  className="btn btn-capture"
                  onClick={capture}
                  disabled={status === "capturing"}
                >
                  {status === "capturing" ? (
                    <>
                      <span className="spinner-sm" /> Processing…
                    </>
                  ) : (
                    "Capture Face"
                  )}
                </button>
              )}

              {status === "success" && (
                <div className="success-state">
                  <div className="success-icon">✓</div>
                  <p className="success-msg">Enrolled successfully!</p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={reset}
                  >
                    Enroll Another
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status message */}
        {message && (
          <p
            className={`status-message ${status === "error" ? "is-error" : ""}`}
          >
            {message}
          </p>
        )}
      </div>

      {/* People list with enrollment status */}
      <div className="people-list">
        <h3 className="list-title">All People ({people.length})</h3>
        <div className="list-grid">
          {people.map((p) => (
            <div
              key={p.id}
              className={`list-item ${p.enrolled ? "is-enrolled" : ""}`}
            >
              <div className="list-avatar">
                {p.name.charAt(0).toUpperCase()}
              </div>
              <div className="list-info">
                <span className="list-name">{p.name}</span>
                {p.department && (
                  <span className="list-dept">{p.department}</span>
                )}
              </div>
              <span
                className={`list-badge ${p.enrolled ? "enrolled" : "pending"}`}
              >
                {p.enrolled ? "Enrolled" : "Pending"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
