-- AI-written meta titles/descriptions, counted per month like the other meters.
ALTER TABLE "Usage" ADD COLUMN "aiGenerations" INTEGER NOT NULL DEFAULT 0;
