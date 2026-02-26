import { Hono } from "hono";
import { doctorController } from "../controllers/doctor.controller";
import { safe } from "../lib/safe";
import { availabilityController } from "../controllers/availability.controller";
import { appointmentTypeController } from "../controllers/appointment-type.controller";
import { bookingController } from "../controllers/booking.controller";
import { slotsController } from "../controllers/slots.controller";
import {
  requireAuth,
  requireRole,
  requireOrg,
  requireSelfOrAdmin,
  validateBody,
  validateQuery,
} from "../middlewares";
import {
  createDoctorSchema,
  updateDoctorSchema,
  createAvailabilityRuleSchema,
  updateAvailabilityRuleSchema,
  createAppointmentTypeSchema,
  updateAppointmentTypeSchema,
  createBookingSchema,
  paginationSchema,
  assignDoctorClinicSchema,
} from "../validators";

const doctors = new Hono();

// All doctor routes require authentication and an active organisation
doctors.use("*", requireAuth, requireOrg);

// ── Public (within org) ────────────────────────────────────────────────────────
doctors.get("/", validateQuery(paginationSchema), safe(doctorController.list));
doctors.get("/:id", safe(doctorController.getById));

// ── Admin/Owner only ───────────────────────────────────────────────────────────
doctors.post(
  "/",
  requireRole("owner", "admin"),
  validateBody(createDoctorSchema),
  safe(doctorController.create),
);

doctors.patch(
  "/:id",
  requireRole("owner", "admin"),
  validateBody(updateDoctorSchema),
  safe(doctorController.update),
);

doctors.delete(
  "/:id",
  requireRole("owner", "admin"),
  safe(doctorController.delete),
);

// ── Clinic assignment (admin/owner only) ───────────────────────────────────────
doctors.post(
  "/:id/clinics",
  requireRole("owner", "admin"),
  validateBody(assignDoctorClinicSchema),
  safe(doctorController.assignClinic),
);

doctors.delete(
  "/:id/clinics/:clinicId",
  requireRole("owner", "admin"),
  safe(doctorController.removeClinic),
);

// ── Availability rules ─────────────────────────────────────────────────────────
doctors.get("/:id/availability", safe(availabilityController.listByDoctor));
doctors.get("/:id/availability/:ruleId", safe(availabilityController.getById));

doctors.post(
  "/:id/availability",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(createAvailabilityRuleSchema),
  safe(availabilityController.create),
);

doctors.patch(
  "/:id/availability/:ruleId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(updateAvailabilityRuleSchema),
  safe(availabilityController.update),
);

doctors.delete(
  "/:id/availability/:ruleId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  safe(availabilityController.delete),
);

// ── Appointment types ──────────────────────────────────────────────────────────
doctors.get(
  "/:id/appointment-types",
  safe(appointmentTypeController.listByDoctor),
);

doctors.post(
  "/:id/appointment-types",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(createAppointmentTypeSchema),
  safe(appointmentTypeController.create),
);

doctors.patch(
  "/:id/appointment-types/:typeId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(updateAppointmentTypeSchema),
  safe(appointmentTypeController.update),
);

doctors.delete(
  "/:id/appointment-types/:typeId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  safe(appointmentTypeController.delete),
);

// ── Slots ──────────────────────────────────────────────────────────────────────
doctors.get("/:id/slots/next", safe(slotsController.getNextAvailable));
doctors.get("/:id/slots", safe(slotsController.getSlots));

// ── Bookings / Queue ───────────────────────────────────────────────────────────
doctors.get(
  "/:id/bookings",
  requireRole("owner", "admin", "doctor", "staff"),
  requireSelfOrAdmin,
  safe(bookingController.listByDoctor),
);

doctors.get(
  "/:id/bookings/stats",
  requireRole("owner", "admin", "doctor", "staff"),
  requireSelfOrAdmin,
  safe(bookingController.stats),
);

doctors.post(
  "/:id/bookings",
  validateBody(createBookingSchema),
  safe(bookingController.create),
);

export { doctors as doctorRoutes };
