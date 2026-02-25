import { Hono } from "hono";
import { clinicController } from "../controllers/clinic.controller";
import { patientController } from "../controllers/patient.controller";
import { bookingController } from "../controllers/booking.controller";
import {
  requireAuth,
  requireRole,
  requireOrg,
  validateBody,
  validateQuery,
} from "../middlewares";
import { bookingLimiter } from "../middlewares/rate-limit";
import {
  createClinicSchema,
  updateClinicSchema,
  createPatientSchema,
  updatePatientSchema,
  createBookingSchema,
  updateBookingSchema,
  bookingQuerySchema,
  paginationSchema,
  addClinicMemberSchema,
} from "../validators";
import { z } from "zod";

// ── Clinics ────────────────────────────────────────────────────────────────────
export const clinicRoutes = new Hono();

// Public clinic marketplace
clinicRoutes.get(
  "/marketplace",
  validateQuery(paginationSchema),
  clinicController.marketPlace,
);

// All remaining clinic routes are org-scoped
clinicRoutes.use("*", requireAuth, requireOrg);

clinicRoutes.get("/", validateQuery(paginationSchema), clinicController.list);
clinicRoutes.get("/:id", clinicController.getById);

clinicRoutes.post(
  "/",
  requireRole("owner", "admin"),
  validateBody(createClinicSchema),
  clinicController.create,
);

clinicRoutes.post(
  "/:id/members",
  requireRole("owner", "admin"),
  validateBody(addClinicMemberSchema),
  clinicController.addMember,
);

clinicRoutes.patch(
  "/:id",
  requireRole("owner", "admin"),
  validateBody(updateClinicSchema),
  clinicController.update,
);

clinicRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  clinicController.delete,
);

// ── Patients ───────────────────────────────────────────────────────────────────
export const patientRoutes = new Hono();

// All patient routes require org membership
patientRoutes.use("*", requireAuth, requireOrg);

patientRoutes.get(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateQuery(paginationSchema),
  patientController.list,
);

patientRoutes.get(
  "/:id",
  requireRole("owner", "admin", "doctor", "staff"),
  patientController.getById,
);

patientRoutes.get(
  "/:id/bookings",
  requireRole("owner", "admin", "doctor", "staff"),
  patientController.getBookings,
);

patientRoutes.post(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateBody(createPatientSchema),
  patientController.create,
);

patientRoutes.patch(
  "/:id",
  requireRole("owner", "admin", "staff"),
  validateBody(updatePatientSchema),
  patientController.update,
);

patientRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  patientController.delete,
);

// ── Bookings ───────────────────────────────────────────────────────────────────
export const bookingRoutes = new Hono();

// All booking routes require org membership
bookingRoutes.use("*", requireAuth, requireOrg);

bookingRoutes.get(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateQuery(bookingQuerySchema),
  bookingController.list,
);

bookingRoutes.get("/:id", bookingController.getById);

// Flat POST /bookings alias (doctorId comes from body)
bookingRoutes.post(
  "/",
  bookingLimiter,
  validateBody(
    createBookingSchema.extend({
      doctorId: z.string().uuid(),
    }),
  ),
  async (c) => {
    const body = c.get("validatedBody");
    // Inject doctorId as a route param so bookingController.create can read it
    const originalParam = c.req.param.bind(c.req);
    (c.req as any).param = (key: string) =>
      key === "id" ? body.doctorId : originalParam(key);
    return bookingController.create(c);
  },
);

bookingRoutes.patch(
  "/:id",
  requireRole("owner", "admin", "doctor", "staff"),
  validateBody(updateBookingSchema),
  bookingController.update,
);

bookingRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  bookingController.delete,
);
