import prisma from "../db.server";

// Unauthenticated liveness probe for the host.
//
// Every other route requires a Shopify session, so none of them can be used as
// a probe: they redirect or 401. `npm run check:release` hits this before it
// will release, because a released version pointing at a host that is not
// serving is exactly what failed App Store review.
//
// It round-trips the database as well as the process. A Vercel function boots
// fine with an unreachable Postgres and only fails once a merchant opens the
// app, which is far too late to learn about it - and Prisma loads its query
// engine lazily, so a missing engine binary is invisible until something
// queries.
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response("ok", { status: 200 });
  } catch (error) {
    // The detail goes to the runtime log, never to the public response.
    console.error("healthz: database unreachable", error);
    return new Response("database unreachable", { status: 503 });
  }
};
