import prisma from "../db.server";
import { limit, type PlanName } from "../lib/plans";

export type Meter = "metaEdits" | "altEdits" | "compressions" | "aiGenerations";

export function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getUsage(shop: string) {
  const period = currentPeriod();
  const row = await prisma.usage.findUnique({ where: { shop_period: { shop, period } } });
  return {
    metaEdits: row?.metaEdits ?? 0,
    altEdits: row?.altEdits ?? 0,
    compressions: row?.compressions ?? 0,
    aiGenerations: row?.aiGenerations ?? 0,
  };
}

/** How many more uses of `meter` the plan allows this month (Infinity = unlimited). */
export async function remaining(shop: string, plan: PlanName, meter: Meter): Promise<number> {
  const cap = limit(plan, meter);
  if (cap < 0) return Infinity;
  const used = (await getUsage(shop))[meter];
  return Math.max(0, cap - used);
}

export async function addUsage(shop: string, meter: Meter, amount: number) {
  if (amount <= 0) return;
  const period = currentPeriod();
  await prisma.usage.upsert({
    where: { shop_period: { shop, period } },
    create: { shop, period, [meter]: amount },
    update: { [meter]: { increment: amount } },
  });
}
