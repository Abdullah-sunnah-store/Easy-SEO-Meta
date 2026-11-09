import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// Reuse one client per process in every environment, not only development.
// On Vercel a warm serverless instance re-imports this module, and a fresh
// PrismaClient each time opens another pool against Postgres until the
// database refuses new connections - which surfaces as a 500 on the embedded
// app, intermittently and only under load.
//
// Neon suspends an idle database and takes a few seconds to wake it. Prisma's
// defaults (5 s to connect, 10 s waiting for a pooled connection) were short
// enough to fail the first request after a quiet spell ("Timed out fetching a
// new connection from the connection pool"), so allow more unless the URL
// already says otherwise.
function patientUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("connect_timeout")) u.searchParams.set("connect_timeout", "15");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    return u.toString();
  } catch {
    return url;
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient({ datasourceUrl: patientUrl(process.env.DATABASE_URL) });
global.prismaGlobal = prisma;

export default prisma;
