import { Hono } from "hono";
import { doctorController } from "../controllers/doctor.controller";
import { availabilityController } from "../controllers/availability.controller";
import { appointmentTypeController } from "../controllers/appointment-type.controller";
import { bookingController } from "../controllers/booking.controller";
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
doctors.get("/", validateQuery(paginationSchema), doctorController.list);
doctors.get("/:id", doctorController.getById);

// ── Admin/Owner only ───────────────────────────────────────────────────────────
doctors.post(
  "/",
  requireRole("owner", "admin"),
  validateBody(createDoctorSchema),
  doctorController.create,
);

doctors.patch(
  "/:id",
  requireRole("owner", "admin"),
  validateBody(updateDoctorSchema),
  doctorController.update,
);

doctors.delete(
  "/:id",
  requireRole("owner", "admin"),
  doctorController.delete,
);

// ── Clinic assignment (admin/owner only) ───────────────────────────────────────
doctors.post(
  "/:id/clinics",
  requireRole("owner", "admin"),
  validateBody(assignDoctorClinicSchema),
  doctorController.assignClinic,
);

doctors.delete(
  "/:id/clinics/:clinicId",
  requireRole("owner", "admin"),
  doctorController.removeClinic,
);

// ── Availability rules ─────────────────────────────────────────────────────────
doctors.get("/:id/availability", availabilityController.listByDoctor);
doctors.get("/:id/availability/:ruleId", availabilityController.getById);

doctors.post(
  "/:id/availability",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(createAvailabilityRuleSchema),
  availabilityController.create,
);

doctors.patch(
  "/:id/availability/:ruleId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(updateAvailabilityRuleSchema),
  availabilityController.update,
);

doctors.delete(
  "/:id/availability/:ruleId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  availabilityController.delete,
);

// ── Appointment types ──────────────────────────────────────────────────────────
doctors.get("/:id/appointment-types", appointmentTypeController.listByDoctor);

doctors.post(
  "/:id/appointment-types",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(createAppointmentTypeSchema),
  appointmentTypeController.create,
);

doctors.patch(
  "/:id/appointment-types/:typeId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  validateBody(updateAppointmentTypeSchema),
  appointmentTypeController.update,
);

doctors.delete(
  "/:id/appointment-types/:typeId",
  requireRole("owner", "admin", "doctor"),
  requireSelfOrAdmin,
  appointmentTypeController.delete,
);

// ── Bookings / Queue ───────────────────────────────────────────────────────────
doctors.get(
  "/:id/bookings",
  requireRole("owner", "admin", "doctor", "staff"),
  requireSelfOrAdmin,
  bookingController.listByDoctor,
);

doctors.get(
  "/:id/bookings/stats",
  requireRole("owner", "admin", "doctor", "staff"),
  requireSelfOrAdmin,
  bookingController.stats,
);

doctors.post(
  "/:id/bookings",
  validateBody(createBookingSchema),
  bookingController.create,
);

export { doctors as doctorRoutes };
