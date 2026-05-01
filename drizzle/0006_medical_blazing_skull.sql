CREATE TABLE "doctor_clinic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"current_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doctor_clinic_doctor_date_uniq" UNIQUE("doctor_id","booking_date")
);
--> statement-breakpoint
CREATE TABLE "doctor_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization" varchar(255) NOT NULL,
	"description" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_counter" RENAME TO "certificate";--> statement-breakpoint
ALTER TABLE "doctor" RENAME COLUMN "certification" TO "certificate_id";--> statement-breakpoint
ALTER TABLE "doctor" RENAME COLUMN "experience" TO "experience_id";--> statement-breakpoint
ALTER TABLE "certificate" RENAME COLUMN "doctor_id" TO "name";--> statement-breakpoint
ALTER TABLE "certificate" DROP CONSTRAINT "doctor_counter_doctor_date_uniq";--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_doctor_id_doctor_id_fk";
--> statement-breakpoint
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_patient_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "doctor" DROP CONSTRAINT "doctor_org_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "certificate" DROP CONSTRAINT "doctor_counter_doctor_id_doctor_id_fk";
--> statement-breakpoint
DROP INDEX "doctor_counter_date_idx";--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "doctor_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "doctor" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor" ADD COLUMN "specialized" varchar(50);--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "issued_at" date NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate" ADD COLUMN "expires_at" date;--> statement-breakpoint
ALTER TABLE "doctor_clinic" ADD CONSTRAINT "doctor_clinic_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_clinic_date_idx" ON "doctor_clinic" USING btree ("booking_date");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor" ADD CONSTRAINT "doctor_experience_id_doctor_experience_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."doctor_experience"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor" ADD CONSTRAINT "doctor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor" DROP COLUMN "org_id";--> statement-breakpoint
ALTER TABLE "certificate" DROP COLUMN "booking_date";--> statement-breakpoint
ALTER TABLE "certificate" DROP COLUMN "last_number";