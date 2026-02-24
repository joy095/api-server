CREATE TYPE "public"."book_via" AS ENUM('web', 'app', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('new', 'follow_up', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."recurrence_type" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'doctor', 'staff');--> statement-breakpoint
CREATE TABLE "appointment_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" "patient_status" DEFAULT 'new' NOT NULL,
	"duration_minutes" smallint DEFAULT 15 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"recurrent_type" "recurrence_type" DEFAULT 'weekly' NOT NULL,
	"day_of_week" smallint,
	"day_of_month" smallint,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"breaks" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_type_id" uuid,
	"booking_status" "booking_status" DEFAULT 'pending' NOT NULL,
	"book_via" "book_via" DEFAULT 'walk_in' NOT NULL,
	"daily_serial" smallint NOT NULL,
	"serial_date" date NOT NULL,
	"scheduled_at" timestamp,
	"cancel_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_serial" UNIQUE("doctor_id","daily_serial","serial_date")
);
--> statement-breakpoint
CREATE TABLE "clinic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"address" text,
	"phone" varchar(20),
	"latitude" real,
	"longitude" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"image" text,
	"specialist" varchar(100) NOT NULL,
	"description" text NOT NULL,
	"years_of_exp" smallint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_clinic" (
	"doctor_id" uuid NOT NULL,
	"clinic_id" uuid NOT NULL,
	CONSTRAINT "doctor_clinic_unique" UNIQUE("doctor_id","clinic_id")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"dob" date,
	"phone" varchar(20),
	"email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "account_userId_idx";--> statement-breakpoint
DROP INDEX "session_userId_idx";--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "provider_id" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "scope" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "ip_address" SET DATA TYPE varchar(45);--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "user_agent" SET DATA TYPE varchar(512);--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "identifier" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "doctor_id" uuid;--> statement-breakpoint
ALTER TABLE "appointment_type" ADD CONSTRAINT "appointment_type_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_clinic_id_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_clinic_id_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_appointment_type_id_appointment_type_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_clinic" ADD CONSTRAINT "doctor_clinic_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_clinic" ADD CONSTRAINT "doctor_clinic_clinic_id_clinic_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appt_type_doctor_idx" ON "appointment_type" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "avail_doctor_idx" ON "availability_rules" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "avail_clinic_idx" ON "availability_rules" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "avail_doctor_clinic_idx" ON "availability_rules" USING btree ("doctor_id","clinic_id");--> statement-breakpoint
CREATE INDEX "booking_doctor_date_idx" ON "booking" USING btree ("doctor_id","serial_date");--> statement-breakpoint
CREATE INDEX "booking_patient_idx" ON "booking" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "booking_clinic_idx" ON "booking" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "booking_status_idx" ON "booking" USING btree ("booking_status");--> statement-breakpoint
CREATE INDEX "doctor_clinic_clinic_idx" ON "doctor_clinic" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "patients_email_idx" ON "patients" USING btree ("email");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_doctor_id_doctor_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");