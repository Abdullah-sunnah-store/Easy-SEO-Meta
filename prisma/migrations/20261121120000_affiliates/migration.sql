-- CreateTable
CREATE TABLE "Affiliate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "payoutMethod" TEXT NOT NULL DEFAULT 'bkash',
    "payoutNumber" TEXT NOT NULL DEFAULT '',
    "payoutName" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "promotion" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "Affiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateReferral" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "storeUrl" TEXT NOT NULL,
    "storeName" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "installedOn" TIMESTAMP(3),
    "channel" TEXT NOT NULL DEFAULT 'other',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "howReferred" TEXT NOT NULL DEFAULT '',
    "proof" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "lastCheck" TEXT NOT NULL DEFAULT '',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AffiliateReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referralId" TEXT,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateWithdrawal" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "accountName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueBy" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "bdtAmount" DOUBLE PRECISION,
    "trxId" TEXT NOT NULL DEFAULT '',
    "adminNote" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AffiliateWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopReferral" (
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopReferral_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_code_key" ON "Affiliate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Affiliate_email_key" ON "Affiliate"("email");

-- CreateIndex
CREATE INDEX "AffiliateReferral_shop_idx" ON "AffiliateReferral"("shop");

-- CreateIndex
CREATE INDEX "AffiliateReferral_affiliateId_status_idx" ON "AffiliateReferral"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateId_idx" ON "AffiliateCommission"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_referralId_period_key" ON "AffiliateCommission"("referralId", "period");

-- CreateIndex
CREATE INDEX "AffiliateWithdrawal_affiliateId_status_idx" ON "AffiliateWithdrawal"("affiliateId", "status");

-- AddForeignKey
ALTER TABLE "AffiliateReferral" ADD CONSTRAINT "AffiliateReferral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "AffiliateReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateWithdrawal" ADD CONSTRAINT "AffiliateWithdrawal_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
