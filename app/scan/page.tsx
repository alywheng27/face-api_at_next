/**
 * app/scan/page.tsx
 *
 * This is a Server Component (no "use client").
 * It just renders the page shell and imports the FaceScanner client component.
 *
 * WHY SPLIT SERVER vs CLIENT?
 * Next.js renders Server Components on the server — but face-api.js requires
 * browser APIs (video, canvas, WebGL). So the heavy lifting lives in
 * FaceScanner.tsx which is a Client Component ("use client").
 * The page itself stays server-rendered for fast initial load.
 */
import FaceScanner from "@/components/FaceScanner";

export default function ScanPage() {
  return (
    <>
      <div className="page-header">
        <p className="page-label">Live Identification</p>
        <h1 className="page-title">Face Scanner</h1>
      </div>
      {/*
        FaceScanner is a Client Component.
        Next.js will hydrate it in the browser after the initial HTML load.
        The camera and face-api.js only start running client-side.
      */}
      <FaceScanner />
    </>
  );
}
