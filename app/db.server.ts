import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// Reuse one client per process in every environment, not only development.
// On Vercel a warm serverless instance re-imports this module, and a fresh
// PrismaClient each time opens another pool against Postgres until the
// database refuses new connections - which surfaces as a 500 on the embedded
// app, intermittently and only under load.
const prisma = global.prismaGlobal ?? new PrismaClient();
global.prismaGlobal = prisma;

export default prisma;
