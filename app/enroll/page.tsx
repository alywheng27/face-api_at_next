/**
 * app/enroll/page.tsx
 *
 * Admin-only page for enrolling faces.
 * Same server/client split as the scan page — the page shell is a
 * Server Component, the interactive camera UI is in EnrollPerson.tsx (client).
 */
import EnrollPerson from "@/components/EnrollPerson";

export default function EnrollPage() {
  return (
    <>
      <div className="page-header">
        <p className="page-label">Admin · Face Enrollment</p>
        <h1 className="page-title">Enroll People</h1>
      </div>
      {/*
        ⚠️ PRODUCTION NOTE:
        Protect this page with authentication before deploying.
        Anyone with access can enroll/overwrite face data.
        Use next-auth, Clerk, or middleware-based auth to restrict access.
      */}
      <EnrollPerson />
    </>
  );
}
