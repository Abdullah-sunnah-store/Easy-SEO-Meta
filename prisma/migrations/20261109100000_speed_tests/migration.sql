-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "speedTests" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SpeedTest" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "strategy" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT -1,
    "lcpMs" INTEGER NOT NULL DEFAULT 0,
    "fcpMs" INTEGER NOT NULL DEFAULT 0,
    "tbtMs" INTEGER NOT NULL DEFAULT 0,
    "siMs" INTEGER NOT NULL DEFAULT 0,
    "clsX1000" INTEGER NOT NULL DEFAULT 0,
    "fieldLcpMs" INTEGER NOT NULL DEFAULT -1,
    "fieldInpMs" INTEGER NOT NULL DEFAULT -1,
    "fieldClsX1000" INTEGER NOT NULL DEFAULT -1,
    "fieldCategory" TEXT NOT NULL DEFAULT '',
    "opportunities" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeedTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeedTest_shop_createdAt_idx" ON "SpeedTest"("shop", "createdAt");

