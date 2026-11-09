-- New products: write the SEO title/description with AI instead of templates.
ALTER TABLE "ShopSettings" ADD COLUMN "autoMetaAi" BOOLEAN NOT NULL DEFAULT false;
