/**
 * app/enroll/page.tsx
 *
 * WHAT CHANGED (Server Component upgrade)
 * ────────────────────────────────────────
 * BEFORE: This was a thin shell that rendered <EnrollPerson />, which then
 *         called fetch("/api/people") inside a useEffect to load the dropdown.
 *         That meant the page loaded blank, then the dropdown filled in after
 *         the client-side fetch completed — a visible loading delay.
 *
 * AFTER:  This page is a Server Component (no "use client"). It calls the
 *         getPeople() Server Action directly at render time on the server.
 *         The result is passed as the `initialPeople` prop to <EnrollPerson />.
 *         The dropdown is pre-populated from the very first render — no flash,
 *         no loading spinner, no useEffect fetch needed.
 *
 * HOW SERVER COMPONENTS FETCH DATA
 * ─────────────────────────────────
 * Server Components can be async functions. Next.js runs them on the server
 * before sending any HTML to the browser. Awaiting getPeople() here is
 * equivalent to what you'd do in getServerSideProps in the Pages Router —
 * but co-located right in the component file.
 *
 * NOTE: getPeople() is also the exact same logic as GET /api/people.
 * The API route is kept for third-party use. The Server Action is our
 * internal shortcut that skips the HTTP layer entirely.
 */

import { getPeople } from "@/actions/enroll";
import EnrollPerson from "@/components/EnrollPerson";
import type { PersonOption } from "@/types";

export default async function EnrollPage() {
  // This runs on the server at request time — direct DB call, no HTTP fetch.
  // If it throws, Next.js will render the nearest error.tsx boundary.
  const people: PersonOption[] = await getPeople();

  return (
    <>
      <div className="page-header">
        <p className="page-label">Admin · Face Enrollment</p>
        <h1 className="page-title">Enroll People</h1>
      </div>
      {/*
        EnrollPerson is a Client Component ("use client").
        We pass the pre-fetched people list as a prop so it doesn't need
        to fetch it again on the client. The component takes over from here
        for all interactive work (camera, file upload, folder scan).
 
        ⚠️ PRODUCTION NOTE:
        Protect this page with authentication before deploying.
        Use next-auth, Clerk, or middleware-based auth to restrict access.
      */}
      <EnrollPerson initialPeople={people} />
    </>
  );
}
