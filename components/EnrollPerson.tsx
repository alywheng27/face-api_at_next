"use client";
/**
 * components/EnrollPerson.tsx
 *
 * WHAT CHANGED (Server Actions upgrade)
 * ──────────────────────────────────────
 * BEFORE:
 *   - People list:    fetch("/api/people") in useEffect
 *   - Save descriptor: fetch("/api/enroll", { method: "POST", body: JSON.stringify(...) })
 *   - Folder scan:    fetch("/api/enroll-from-folder", { method: "POST" })
 *
 * AFTER:
 *   - People list:    received as `initialPeople` prop from the Server Component
 *                     parent (app/enroll/page.tsx). No fetch, no useEffect for data.
 *   - Save descriptor: saveDescriptor(personId, descriptor) — Server Action,
 *                     called like a regular async function.
 *   - Folder scan:    enrollFromFolder() — Server Action, same pattern.
 *
 * WHY THIS IS CLEANER
 * ────────────────────
 * Server Actions are imported and called like normal functions. Next.js handles
 * serialising the call to the server under the hood. No fetch(), no headers,
 * no JSON.stringify(), no response.json() — just typed function calls that
 * throw on error, which we catch normally with try/catch.
 *
 * WHAT STAYS CLIENT-SIDE
 * ───────────────────────
 * Everything involving the browser must remain here:
 *   - getUserMedia (webcam)
 *   - FileReader (image upload)
 *   - face-api.js (WebGL inference in the browser)
 *   - useRef on <video> and <img> elements
 *   - useState for tab state, status, messages, results
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getPeopleIds, saveDescriptor } from "@/actions/enroll";
import { getFaceApi, loadModels } from "@/lib/faceapi";
import type { PersonOption } from "@/types";

// Result for one person during client-side folder scan
interface FolderScanResult {
  personId: number;
  name: string;
  file?: string; // filename that was matched (undefined if no_image)
  status: "enrolled" | "no_face" | "no_image" | "error";
  error?: string;
}

type Tab = "camera" | "upload" | "folder";

type Status =
  | "idle"
  | "loading"
  | "camera-ready"
  | "processing"
  | "success"
  | "error";

interface Props {
  // Pre-fetched by the Server Component parent — no loading needed on mount
  initialPeople: PersonOption[];
}

export default function EnrollPerson({ initialPeople }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);

  const [people, setPeople] = useState<PersonOption[]>(initialPeople);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("camera");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  // Folder scan result per person ID checked
  const [folderResults, setFolderResults] = useState<FolderScanResult[] | null>(
    null,
  );
  // Progress tracking during folder scan
  const [folderProgress, setFolderProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
  }, []);

  // ── Load face-api.js models only (no people fetch needed anymore) ────────────
  useEffect(() => {
    async function init() {
      try {
        await loadModels();
        setModelsLoaded(true);
        setStatus("idle");
      } catch {
        setStatus("error");
        setMessage(
          "Failed to load AI models. Check that /public/models/ is populated.",
        );
      }
    }
    init();
    return () => stopCamera();
  }, [stopCamera]);

  // ─── Load models + people list on mount ────────────────────────────────────
  // useEffect(() => {
  //   async function init() {
  //     try {
  //       // Load face-api models in parallel with the people list fetch
  //       const [_, peopleRes] = await Promise.all([
  //         loadModels(),
  //         fetch("/api/people"),
  //       ]);

  //       const peopleData: PersonOption[] = await peopleRes.json();
  //       setPeople(peopleData);
  //       setModelsLoaded(true);
  //       setStatus("idle");
  //     } catch (err) {
  //       setStatus("error");
  //       setMessage(
  //         "Failed to initialize. Check your connection and try again.",
  //       );
  //     }
  //   }
  //   init();

  //   // Cleanup camera on unmount
  //   return () => stopCamera();
  // }, [stopCamera]);

  function switchTab(tab: Tab) {
    stopCamera();
    setActiveTab(tab);
    setStatus("idle");
    setMessage("");
    setUploadPreview(null);
    setSelectedId("");
    setFolderResults(null);
  }

  function resetForm() {
    stopCamera();
    setStatus("idle");
    setMessage("");
    setUploadPreview(null);
    setSelectedId("");
    setFolderResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function markEnrolled(id: number) {
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enrolled: true } : p)),
    );
  }
  // ─────────────────────────────────────────────────────────────────────────────
  // TAB 1 — CAMERA
  // ─────────────────────────────────────────────────────────────────────────────
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
        faceapi.draw.drawFaceLandmarks(canvas, faceAIData);
        faceapi.draw.drawFaceExpressions(canvas, faceAIData);

        faceAIData.forEach((face) => {
          const { age, gender, genderProbability } = face;
          const genderText = `${gender} - ${(Math.round(genderProbability * 100) / 100) * 100}`;
          const ageText = `${Math.round(age)} years old`;
          const textField = new faceapi.draw.DrawTextField(
            [genderText, ageText],
            face.detection.box.topRight,
          );
          textField.draw(canvas);
        });
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

  async function captureFromCamera() {
    if (!selectedId || !videoRef.current) return;
    setStatus("processing");
    setMessage("");

    try {
      const faceapi = getFaceApi();
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
          "⚠ No face detected. Ensure your face is well-lit and centered.",
        );
        return;
      }

      // ── Server Action call (replaces fetch("/api/enroll", POST)) ─────────────
      await saveDescriptor(selectedId, Array.from(detection.descriptor));

      markEnrolled(selectedId);
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

  // ─── Capture and enroll ───────────────────────────────────────────────────────
  // async function capture() {
  //   if (!selectedId || !videoRef.current) return;
  //   setStatus("capturing");
  //   setMessage("");

  //   try {
  //     const faceapi = getFaceApi();

  //     // Try to detect a face in the current video frame
  //     const detection = await faceapi
  //       .detectSingleFace(
  //         videoRef.current,
  //         new faceapi.TinyFaceDetectorOptions({
  //           inputSize: 320,
  //           scoreThreshold: 0.5,
  //         }),
  //       )
  //       .withFaceLandmarks()
  //       .withFaceDescriptor();

  //     if (!detection) {
  //       setStatus("camera-ready");
  //       setMessage(
  //         "⚠ No face detected. Make sure your face is well-lit and clearly visible.",
  //       );
  //       return;
  //     }

  //     // Convert Float32Array to a plain number[] for JSON serialization
  //     const descriptor = Array.from(detection.descriptor);

  //     // Save to MSSQL via the enroll API route
  //     const res = await fetch("/api/enroll", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ personId: selectedId, descriptor }),
  //     });

  //     if (!res.ok) {
  //       const err = await res.json();
  //       throw new Error(err.error || "Enrollment failed");
  //     }

  //     // Update the local list to mark this person as enrolled
  //     setPeople((prev) =>
  //       prev.map((p) => (p.id === selectedId ? { ...p, enrolled: true } : p)),
  //     );

  //     setStatus("success");
  //     setMessage("Face enrolled successfully!");
  //     stopCamera();
  //   } catch (err: unknown) {
  //     setStatus("camera-ready");
  //     setMessage(
  //       err instanceof Error ? err.message : "Enrollment failed. Try again.",
  //     );
  //   }
  // }

  // ─────────────────────────────────────────────────────────────────────────────
  // TAB 2 — UPLOAD IMAGE
  // ─────────────────────────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadPreview(ev.target?.result as string);
      setStatus("idle");
      setMessage("");
    };
    reader.readAsDataURL(file);
  }

  async function enrollFromUpload() {
    if (!selectedId || !uploadPreview || !previewImgRef.current) return;
    setStatus("processing");
    setMessage("");

    try {
      const faceapi = getFaceApi();
      const img = previewImgRef.current;

      // Wait for image to be fully decoded
      await new Promise<void>((resolve) => {
        if (img.complete) return resolve();
        img.onload = () => resolve();
      });

      const detection = await faceapi
        .detectSingleFace(
          img,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5,
          }),
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        setStatus("idle");
        setMessage(
          "⚠ No face detected. Use a clearer photo with good lighting.",
        );
        return;
      }

      // ── Server Action call (replaces fetch("/api/enroll", POST)) ─────────────
      await saveDescriptor(selectedId, Array.from(detection.descriptor));

      markEnrolled(selectedId);
      setStatus("success");
      setMessage("Face enrolled from image successfully!");
    } catch (err: unknown) {
      setStatus("idle");
      setMessage(
        err instanceof Error ? err.message : "Enrollment failed. Try again.",
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TAB 3 — FOLDER SCAN (fully client-side)
  // ─────────────────────────────────────────────────────────────────────────────
  //
  // HOW IT WORKS:
  //  1. showDirectoryPicker() — user picks a local folder (Chrome/Edge only)
  //  2. getPeopleIds() Server Action — fetch all {id, name} from DB
  //  3. For each person ID, check if {id}.jpg / {id}.jpeg / {id}.png / {id}.webp
  //     exists in the picked folder
  //  4. For each matched file: read as File object → create object URL →
  //     draw to hidden <img> → face-api.js generates descriptor in the browser
  //  5. Call saveDescriptor() Server Action for each successful detection
  //  6. Show results table
  //
  // WHY CLIENT-SIDE:
  //  The old approach used @tensorflow/tfjs-node + canvas (native packages) on
  //  the server. These require node-gyp / Visual Studio Build Tools and are
  //  notoriously hard to install on Windows. Running face-api.js in the browser
  //  needs zero native packages — it's the same runtime as camera and upload tabs.
  //
  // FILE NAMING:
  //  Images must be named by the person's DB id: 1.jpg, 42.png, 100.webp etc.
  //  Supported extensions: .jpg .jpeg .png .webp

  async function runFolderScan() {
    setStatus("processing");
    setMessage("");
    setFolderResults(null);
    setFolderProgress(null);

    try {
      // ── Step 1: Open folder picker ────────────────────────────────────────
      // showDirectoryPicker is a browser File System Access API.
      // TypeScript doesn't include it in lib.dom by default, so we cast window.
      const dirHandle = await (
        window as typeof window & {
          showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker();

      // ── Step 2: Collect all file entries from the chosen folder ───────────
      const SUPPORTED = [".jpg", ".jpeg", ".png", ".webp"];
      const fileMap = new Map<string, File>(); // basename (no ext) → File

      // for await (const entry of dirHandle as unknown as AsyncIterable<FileSystemHandle>) {
      //   if (entry.kind !== "file") continue;
      //   const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      //   if (!SUPPORTED.includes(ext)) continue;
      //   // Key = filename without extension (e.g. "42" from "42.jpg")
      //   const base = entry.name.slice(0, entry.name.lastIndexOf("."));
      //   // Only keep the first file found for each base name
      //   if (!fileMap.has(base)) {
      //     fileMap.set(base, await (entry as FileSystemFileHandle).getFile());
      //   }
      // }

      for await (const entry of dirHandle.values()) {
        console.log(entry);
        // Skip subdirectories
        if (entry.kind !== "file") continue;
        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
        if (!SUPPORTED.includes(ext)) continue;
        // Key = filename without extension (e.g. "42" from "42.jpg")
        const base = entry.name.slice(0, entry.name.lastIndexOf("."));
        // Only keep the first file found for each base name (42.jpg wins over 42.png)
        if (!fileMap.has(base)) {
          fileMap.set(base, await (entry as FileSystemFileHandle).getFile());
        }
      }

      if (fileMap.size === 0) {
        setStatus("error");
        setMessage(
          "No supported images (.jpg .jpeg .png .webp) found in the selected folder.",
        );
        return;
      }

      // ── Step 3: Fetch all person IDs from DB ─────────────────────────────
      const people = await getPeopleIds();
      const faceapi = getFaceApi();

      const results: FolderScanResult[] = [];
      let enrolled = 0;

      setFolderProgress({ current: 0, total: people.length });

      // ── Step 4: Process each person ID ───────────────────────────────────
      for (let i = 0; i < people.length; i++) {
        const person = people[i];
        const idStr = String(person.id);

        setFolderProgress({ current: i + 1, total: people.length });

        // Check if a file exists for this ID
        const file = fileMap.get(idStr);
        if (!file) {
          // No image for this person — skip silently
          results.push({
            personId: person.id,
            name: person.name,
            status: "no_image",
          });
          continue;
        }

        try {
          // Load the file into an object URL → assign to a hidden img element
          const objectUrl = URL.createObjectURL(file);
          const img = new Image();

          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = objectUrl;
          });

          // Run face detection in the browser (same as upload tab)
          const detection = await faceapi
            .detectSingleFace(
              img,
              new faceapi.TinyFaceDetectorOptions({
                inputSize: 320,
                scoreThreshold: 0.5,
              }),
            )
            .withFaceLandmarks()
            .withFaceDescriptor();

          URL.revokeObjectURL(objectUrl); // free memory

          if (!detection) {
            results.push({
              personId: person.id,
              name: person.name,
              status: "no_face",
              file: file.name,
            });
            continue;
          }

          // Save descriptor via Server Action
          await saveDescriptor(person.id, Array.from(detection.descriptor));
          markEnrolled(person.id);
          enrolled++;
          results.push({
            personId: person.id,
            name: person.name,
            status: "enrolled",
            file: file.name,
          });
        } catch (err: unknown) {
          results.push({
            personId: person.id,
            name: person.name,
            status: "error",
            file: file.name,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      // ── Step 5: Show results ──────────────────────────────────────────────
      const failed = results.filter(
        (r) => r.status !== "enrolled" && r.status !== "no_image",
      ).length;
      setFolderResults(results.filter((r) => r.status !== "no_image")); // hide skipped rows
      setFolderProgress(null);
      setStatus("success");
      setMessage(`Done — ${enrolled} enrolled, ${failed} failed.`);

      // Refresh people list enrollment status
      const { getPeople } = await import("@/actions/enroll");
      setPeople(await getPeople());
    } catch (err: unknown) {
      setFolderProgress(null);
      // User cancelled the folder picker — don't show an error
      if (err instanceof Error && err.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Folder scan failed.");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SHARED: person selector sub-component
  // ─────────────────────────────────────────────────────────────────────────────
  const selectedPerson = people.find((p) => p.id === selectedId);

  const PersonSelector = ({ disabled }: { disabled: boolean }) => (
    <div className="field">
      <label className="field-label" htmlFor="select">
        Select Person
      </label>
      <select
        id="select"
        className="field-select"
        value={selectedId}
        onChange={(e) => {
          setSelectedId(e.target.value ? Number(e.target.value) : "");
          setStatus("idle");
          setMessage("");
          setUploadPreview(null);
          stopCamera();
        }}
        disabled={disabled || !modelsLoaded}
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
      {selectedPerson?.enrolled && (
        <p className="field-hint">
          ✓ Already enrolled — enrolling again will overwrite
        </p>
      )}
    </div>
  );

  return (
    <div className="enroll-wrapper">
      <div className="enroll-card">
        {status === "loading" && (
          <div className="enroll-loading">
            <div className="spinner" />
            <p>Loading AI models…</p>
          </div>
        )}

        {status !== "loading" && (
          <>
            {/* Tabs */}
            <div className="tab-bar">
              <button
                type="button"
                className={`tab-btn ${activeTab === "camera" ? "active" : ""}`}
                onClick={() => switchTab("camera")}
              >
                <span className="tab-icon">◉</span> Camera
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "upload" ? "active" : ""}`}
                onClick={() => switchTab("upload")}
              >
                <span className="tab-icon">↑</span> Upload Image
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "folder" ? "active" : ""}`}
                onClick={() => switchTab("folder")}
              >
                <span className="tab-icon">⊞</span> Folder Scan
              </button>
            </div>

            {/* ── TAB 1: Camera ── */}
            {activeTab === "camera" && (
              <div className="tab-content">
                <p className="tab-desc">
                  Select a person, open the camera, and capture their face live.
                </p>
                <PersonSelector disabled={status === "processing"} />
                {selectedId !== "" && (
                  <div className="camera-area">
                    <div style={{ position: "relative" }}>
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        onLoadedMetadata={handleVideoMetadata}
                        className={`enroll-video ${status === "camera-ready" || status === "processing" ? "visible" : "hidden"}`}
                      />
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
                    {(status === "camera-ready" || status === "processing") && (
                      <button
                        type="button"
                        className="btn btn-capture"
                        onClick={captureFromCamera}
                        disabled={status === "processing"}
                      >
                        {status === "processing" ? (
                          <>
                            <span className="spinner-sm" /> Processing…
                          </>
                        ) : (
                          "Capture Face"
                        )}
                      </button>
                    )}
                    {status === "success" && (
                      <SuccessState message={message} onReset={resetForm} />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── TAB 2: Upload Image ── */}
            {activeTab === "upload" && (
              <div className="tab-content">
                <p className="tab-desc">
                  Select a person, then upload a clear photo of their face (JPG,
                  PNG, WEBP).
                </p>
                <PersonSelector disabled={status === "processing"} />
                {selectedId !== "" && (
                  <div className="upload-area">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp"
                      onChange={handleFileChange}
                      style={{ display: "none" }}
                    />
                    {!uploadPreview && (
                      <button
                        type="button"
                        className="upload-dropzone"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={status === "processing"}
                      >
                        <span className="upload-icon">↑</span>
                        <span className="upload-label">
                          Click to select an image
                        </span>
                        <span className="upload-hint">JPG · PNG · WEBP</span>
                      </button>
                    )}
                    {uploadPreview && status !== "success" && (
                      <div className="upload-preview-area">
                        {/* Must stay in DOM — face-api.js reads from this img element */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={previewImgRef}
                          src={uploadPreview}
                          alt="Preview"
                          className="upload-preview"
                          crossOrigin="anonymous"
                        />
                        <div className="upload-actions">
                          <button
                            type="button"
                            className="btn btn-capture"
                            onClick={enrollFromUpload}
                            disabled={status === "processing"}
                          >
                            {status === "processing" ? (
                              <>
                                <span className="spinner-sm" /> Detecting face…
                              </>
                            ) : (
                              "Enroll from Image"
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setUploadPreview(null);
                              setMessage("");
                              if (fileInputRef.current)
                                fileInputRef.current.value = "";
                            }}
                            disabled={status === "processing"}
                          >
                            Change Image
                          </button>
                        </div>
                      </div>
                    )}
                    {status === "success" && (
                      <SuccessState message={message} onReset={resetForm} />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── TAB 3: Folder Scan ── */}
            {activeTab === "folder" && (
              <div className="tab-content">
                <p className="tab-desc">
                  Pick a folder containing images named by person ID. Each image
                  is processed in the browser — no server packages needed.
                </p>

                {/* Naming convention info */}
                <div className="folder-naming">
                  <p className="folder-naming-title">File naming convention</p>
                  <div className="naming-examples">
                    <div className="naming-row naming-row--header">
                      <span>DB id</span>
                      <span></span>
                      <span>Filename</span>
                    </div>
                    <div className="naming-row">
                      <code>1</code>
                      <span className="naming-arrow">→</span>
                      <code>1.jpg · 1.png · 1.webp</code>
                    </div>
                    <div className="naming-row">
                      <code>42</code>
                      <span className="naming-arrow">→</span>
                      <code>42.jpg · 42.jpeg</code>
                    </div>
                  </div>
                  <p className="folder-naming-note">
                    ⚠ Chrome and Edge only — Firefox and Safari do not support
                    folder picking.
                  </p>
                </div>

                {/* Progress bar shown while scanning */}
                {status === "processing" && folderProgress && (
                  <div className="folder-progress">
                    <div className="folder-progress-label">
                      <span>Processing…</span>
                      <span className="folder-progress-count">
                        {folderProgress.current} / {folderProgress.total}
                      </span>
                    </div>
                    <div className="folder-progress-track">
                      <div
                        className="folder-progress-fill"
                        style={{
                          width: `${(folderProgress.current / folderProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {status !== "success" && (
                  <button
                    type="button"
                    className="btn btn-primary btn-full"
                    onClick={runFolderScan}
                    disabled={status === "processing" || !modelsLoaded}
                  >
                    {status === "processing" ? (
                      <>
                        <span className="spinner-sm" /> Scanning…
                      </>
                    ) : (
                      "Select Folder and Enroll All"
                    )}
                  </button>
                )}

                {/* Results table */}
                {folderResults && folderResults.length > 0 && (
                  <div className="folder-results">
                    <p className="folder-results-title">
                      Results — {folderResults.length} processed
                    </p>
                    <div className="results-table">
                      {folderResults.map((r, i) => (
                        <div
                          key={`${i} - ${r}`}
                          className={`result-row result-row--${r.status}`}
                        >
                          <div className="result-row-left">
                            <span
                              className={`result-status-dot dot--${r.status}`}
                            />
                            <div className="result-row-names">
                              <span className="result-person">{r.name}</span>
                              {r.file && (
                                <span className="result-file">{r.file}</span>
                              )}
                            </div>
                          </div>
                          <span className={`result-tag tag--${r.status}`}>
                            {r.status === "enrolled" && "Enrolled"}
                            {r.status === "no_face" && "No face"}
                            {r.status === "error" && "Error"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: "1rem" }}
                      onClick={resetForm}
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Shared status message */}
            {message && status !== "success" && (
              <p
                className={`status-message ${status === "error" ? "is-error" : ""}`}
              >
                {message}
              </p>
            )}
          </>
        )}
      </div>

      {/* Sidebar people list */}
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

function SuccessState({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <div className="success-state">
      <div className="success-icon">✓</div>
      <p className="success-msg">{message}</p>
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Enroll Another
      </button>
    </div>
  );
}
