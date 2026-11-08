import prisma from "../db.server";

export async function getSettings(shop: string) {
  return prisma.shopSettings.upsert({ where: { shop }, create: { shop }, update: {} });
}

export async function updateSettings(
  shop: string,
  data: Partial<Omit<Awaited<ReturnType<typeof getSettings>>, "shop" | "updatedAt">>,
) {
  await getSettings(shop);
  return prisma.shopSettings.update({ where: { shop }, data });
}
