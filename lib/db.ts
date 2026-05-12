/**
 * lib/db.ts
 *
 * WHY A SINGLETON?
 * Next.js API routes are serverless functions — they can be called many times
 * per second. Opening a new SQL connection on every request is slow and burns
 * connection pool limits. We keep one shared pool and reuse it.
 *
 * HOW IT WORKS:
 * The first time getDb() is called, it creates a connection pool and caches it
 * in the `pool` variable. Every subsequent call returns the same pool instantly.
 */

import sql from "mssql";

// ─── Connection config built from .env.local ──────────────────────────────────
const config: sql.config = {
  server: process.env.MSSQL_SERVER!, // e.g. "localhost" or "myserver.database.windows.net"
  database: process.env.MSSQL_DATABASE4!,
  user: process.env.MSSQL_USER!,
  password: process.env.MSSQL_PASSWORD!,
  port: parseInt(process.env.MSSQL_PORT || "1433"),
  options: {
    encrypt: false, // disable SSL for local SQL Server
    trustServerCertificate: true, // trust self-signed certs on local installs
    enableArithAbort: true,
    // Node.js 18+ uses OpenSSL 3 which dropped support for older TLS protocols
    // that local SQL Server instances often use. This forces TLS 1.2 compatibility.
    cryptoCredentialsDetails: {
      minVersion: "TLSv1",
    },
  },
  pool: {
    max: 10, // max simultaneous connections
    min: 0,
    idleTimeoutMillis: 30000, // close idle connections after 30s
  },
};

// Module-level cache — persists across API route invocations in the same process
let pool: sql.ConnectionPool | null = null;

/**
 * Returns the shared connection pool.
 * Connects on first call, reuses on subsequent calls.
 */
export async function getDb(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;

  pool = await sql.connect(config);
  console.log("✅ MSSQL connected");
  return pool;
}

/**
 * Closes the pool (useful in tests or graceful shutdown).
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
