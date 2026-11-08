-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "templates" TEXT NOT NULL DEFAULT '{}',
    "autoMetaNewProducts" BOOLEAN NOT NULL DEFAULT false,
    "autoRedirectDeleted" BOOLEAN NOT NULL DEFAULT true,
    "autoRedirectHandleChange" BOOLEAN NOT NULL DEFAULT true,
    "deletedRedirectTarget" TEXT NOT NULL DEFAULT '/collections/all',
    "llmsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "llmsRedirectId" TEXT NOT NULL DEFAULT '',
    "llmsIntro" TEXT NOT NULL DEFAULT '',
    "llmsText" TEXT NOT NULL DEFAULT '',
    "llmsGeneratedAt" TIMESTAMP(3),
    "compressMaxEdge" INTEGER NOT NULL DEFAULT 2048,
    "compressQuality" INTEGER NOT NULL DEFAULT 80,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "AuditRun" (
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "phase" TEXT NOT NULL DEFAULT 'product',
    "cursor" TEXT NOT NULL DEFAULT '',
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "cap" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "AuditItem" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "handle" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL DEFAULT '',
    "seoTitle" TEXT NOT NULL DEFAULT '',
    "seoDescription" TEXT NOT NULL DEFAULT '',
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "missingAlt" INTEGER NOT NULL DEFAULT 0,
    "bodyLength" INTEGER NOT NULL DEFAULT 0,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "issues" TEXT NOT NULL DEFAULT '[]',
    "score" INTEGER NOT NULL DEFAULT 100,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditImage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "alt" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkRef" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL,
    "broken" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LinkRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductHandle" (
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,

    CONSTRAINT "ProductHandle_pkey" PRIMARY KEY ("shop","productId")
);

-- CreateTable
CREATE TABLE "Usage" (
    "shop" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metaEdits" INTEGER NOT NULL DEFAULT 0,
    "altEdits" INTEGER NOT NULL DEFAULT 0,
    "compressions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("shop","period")
);

-- CreateTable
CREATE TABLE "CompressedImage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "productId" TEXT NOT NULL DEFAULT '',
    "productTitle" TEXT NOT NULL DEFAULT '',
    "backupFileId" TEXT NOT NULL DEFAULT '',
    "originalBytes" INTEGER NOT NULL DEFAULT 0,
    "newBytes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompressedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedirectLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditItem_shop_resource_idx" ON "AuditItem"("shop", "resource");

-- CreateIndex
CREATE UNIQUE INDEX "AuditItem_shop_resourceId_key" ON "AuditItem"("shop", "resourceId");

-- CreateIndex
CREATE INDEX "AuditImage_shop_productId_idx" ON "AuditImage"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditImage_shop_mediaId_key" ON "AuditImage"("shop", "mediaId");

-- CreateIndex
CREATE INDEX "LinkRef_shop_broken_idx" ON "LinkRef"("shop", "broken");

-- CreateIndex
CREATE INDEX "CompressedImage_shop_status_idx" ON "CompressedImage"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompressedImage_shop_mediaId_key" ON "CompressedImage"("shop", "mediaId");

-- CreateIndex
CREATE INDEX "RedirectLog_shop_createdAt_idx" ON "RedirectLog"("shop", "createdAt");

