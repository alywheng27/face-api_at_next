/**
 * app/page.tsx — Home / landing page
 */
export default function Home() {
  return (
    <div className="home-hero">
      <p className="home-label">Face Recognition System · v1.0</p>
      <h1 className="home-title">
        Identify people
        <br />
        <strong>instantly.</strong>
      </h1>
      <p className="home-desc">
        Camera-based face identification powered by face-api.js running locally
        in the browser. No images stored — only face descriptors in your MSSQL
        database.
      </p>

      <div className="home-cards">
        <a href="/scan" className="home-card">
          <p className="card-number">01 /</p>
          <h2 className="card-title">Scanner</h2>
          <p className="card-desc">
            Open the live camera feed and identify people in real time against
            your enrolled database.
          </p>
          <p className="card-arrow">Open scanner →</p>
        </a>

        <a href="/enroll" className="home-card">
          <p className="card-number">02 /</p>
          <h2 className="card-title">Enroll Faces</h2>
          <p className="card-desc">
            Register face descriptors for existing people in your database. Each
            person needs to be enrolled once.
          </p>
          <p className="card-arrow">Enroll people →</p>
        </a>
      </div>
    </div>
  );
}
