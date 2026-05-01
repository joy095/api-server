CREATE TYPE "public"."appointment_status" AS ENUM('waiting', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "doctor_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doctor_counter_doctor_date_uniq" UNIQUE("id","doctor_id","booking_date")
);
--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "certification" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "booking_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "booking_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "status" "appointment_status" DEFAULT 'waiting' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor" ADD COLUMN "slot_duration_mins" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor" ADD COLUMN "org_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_counter" ADD CONSTRAINT "doctor_counter_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_counter_date_idx" ON "doctor_counter" USING btree ("booking_date");--> statement-breakpoint
ALTER TABLE "doctor" ADD CONSTRAINT "doctor_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_doctor_date_idx" ON "appointment" USING btree ("doctor_id","booking_date");--> statement-breakpoint
CREATE INDEX "appointment_status_idx" ON "appointment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "doctor_name_idx" ON "doctor" USING btree ("name");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_date_number_uniq" UNIQUE("doctor_id","booking_date","booking_number");