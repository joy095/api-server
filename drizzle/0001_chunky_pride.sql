CREATE TYPE "public"."availability_pattern" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."day_segment" AS ENUM('morning', 'afternoon', 'evening', 'night');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');--> statement-breakpoint
CREATE TABLE "doctor_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"organization_id" text,
	"template_id" uuid,
	"date" date NOT NULL,
	"segment" "day_segment" NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5),
	"last_number" integer DEFAULT 0 NOT NULL,
	"current_number" integer DEFAULT 0 NOT NULL,
	"is_cancelled" boolean DEFAULT false,
	"max_capacity" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_avail_date_shift_uniq" UNIQUE("doctor_id","date","start_time")
);
--> statement-breakpoint
CREATE TABLE "doctor_availability_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"organization_id" text,
	"pattern" "availability_pattern" NOT NULL,
	"day_of_week" "day_of_week",
	"day_of_month" integer,
	"segment" "day_segment" NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5),
	"max_capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "template_uniq" UNIQUE("doctor_id","pattern","day_of_week","day_of_month","segment","start_time")
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"address" text NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(50) NOT NULL,
	"lat" numeric(9, 6),
	"lng" numeric(10, 6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_clinic" RENAME TO "doctor_education";--> statement-breakpoint
ALTER TABLE "appointment" RENAME COLUMN "no_of_patient" TO "organization_id";--> statement-breakpoint
ALTER TABLE "doctor_education" RENAME COLUMN "booking_date" TO "degree";--> statement-breakpoint
ALTER TABLE "doctor_education" RENAME COLUMN "last_number" TO "university";--> statement-breakpoint
ALTER TABLE "doctor_education" RENAME COLUMN "current_number" TO "graduation_year";--> statement-breakpoint
ALTER TABLE "doctor_education" DROP CONSTRAINT "doctor_clinic_doctor_date_uniq";--> statement-breakpoint
ALTER TABLE "doctor_education" DROP CONSTRAINT "doctor_clinic_doctor_id_doctor_id_fk";
--> statement-breakpoint
DROP INDEX "doctor_clinic_date_idx";--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "slot_duration_mins" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doctor" ALTER COLUMN "slot_duration_mins" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor" ADD COLUMN "slug" varchar(80) NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "availability_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_template_id_doctor_availability_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."doctor_availability_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability_template" ADD CONSTRAINT "doctor_availability_template_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability_template" ADD CONSTRAINT "doctor_availability_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avail_doctor_date_idx" ON "doctor_availability" USING btree ("doctor_id","date");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_availability_id_doctor_availability_id_fk" FOREIGN KEY ("availability_id") REFERENCES "public"."doctor_availability"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_education" ADD CONSTRAINT "doctor_education_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificate_doctor_id_idx" ON "certificate" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_slug_idx" ON "doctor" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "doctor_specialized_idx" ON "doctor" USING btree ("specialized");--> statement-breakpoint
CREATE INDEX "doctor_user_id_idx" ON "doctor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "doctor_active_idx" ON "doctor" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "experience_doctor_id_idx" ON "doctor_experience" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "appointment_status_idx" ON "appointment" USING btree ("status");--> statement-breakpoint
ALTER TABLE "doctor" ADD CONSTRAINT "doctor_slug_unique" UNIQUE("slug");