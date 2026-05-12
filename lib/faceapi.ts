/**
 * lib/faceapi.ts
 *
 * WHY THIS FILE EXISTS:
 * face-api.js models are large (~6MB total). We only want to load them once,
 * not on every component mount or every scan tick.
 *
 * This module keeps a `loaded` flag so loadModels() is a no-op after the
 * first successful call — safe to call from useEffect as many times as needed.
 *
 * IMPORTANT: This file must only ever run in the browser (client components).
 * Never import it in an API route or any server-side file.
 */

// We use a dynamic import pattern to avoid SSR issues.
// face-api.js touches `document` and `window` at import time.
let faceapi: typeof import("face-api.js") | null = null;
let loaded = false;

/**
 * Dynamically imports face-api.js (browser only) and loads the three models
 * we need from /public/models/:
 *
 *  1. tinyFaceDetector   — fast face bounding-box detection
 *  2. faceLandmark68Net  — finds 68 key points on the face (eyes, nose, etc.)
 *  3. faceRecognitionNet — converts landmarks into a 128-number descriptor
 *
 * The descriptor is what we compare for identity matching.
 */
export async function loadModels(): Promise<typeof import("face-api.js")> {
  if (loaded && faceapi) return faceapi;

  // Dynamic import — only executes in the browser
  faceapi = await import("face-api.js");

  const MODEL_URL = "/models"; // served from /public/models/

  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);

  loaded = true;
  console.log("✅ face-api.js models loaded");
  return faceapi;
}

/**
 * Returns the cached faceapi module.
 * Must call loadModels() first.
 */
export function getFaceApi() {
  if (!faceapi) throw new Error("Call loadModels() before getFaceApi()");
  return faceapi;
}
