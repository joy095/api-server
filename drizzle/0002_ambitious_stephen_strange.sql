ALTER TABLE "doctor" DROP CONSTRAINT "doctor_slug_unique";--> statement-breakpoint
DROP INDEX "doctor_slug_idx";--> statement-breakpoint
ALTER TABLE "certificate" ALTER COLUMN "name" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "description" text;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_slug_unique_active" ON "doctor" USING btree ("slug") WHERE "doctor"."deleted_at" is null;