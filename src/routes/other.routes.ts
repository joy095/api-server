import { Hono } from "hono";
import { clinicController } from "../controllers/clinic.controller";
import { patientController } from "../controllers/patient.controller";
import { bookingController } from "../controllers/booking.controller";
import { safe } from "../lib/safe";
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
  safe(clinicController.marketPlace),
);

// The basic list and lookup endpoints only require a valid session –
// they do *not* need an active organisation.  Historically we applied
// `requireOrg` to everything after the marketplace which meant callers
// who hadn't chosen an org would get a 403 when hitting `/` or `/:id`.

clinicRoutes.get(
  "/",
  requireAuth,
  validateQuery(paginationSchema),
  safe(clinicController.list),
);
// clinicRoutes.get("/:id", requireAuth, safe(clinicController.getById)); // Note working with better auth

// All other clinic routes are org-scoped and therefore require both
// authentication *and* an active organisation.
clinicRoutes.use("*", requireAuth, requireOrg);

clinicRoutes.post(
  "/",
  requireRole("owner", "admin"),
  validateBody(createClinicSchema),
  safe(clinicController.create),
);

clinicRoutes.post(
  "/:id/members",
  requireRole("owner", "admin"),
  validateBody(addClinicMemberSchema),
  safe(clinicController.addMember),
);

clinicRoutes.patch(
  "/:id",
  requireRole("owner", "admin"),
  validateBody(updateClinicSchema),
  safe(clinicController.update),
);

clinicRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  safe(clinicController.delete),
);

// ── Patients ───────────────────────────────────────────────────────────────────
export const patientRoutes = new Hono();

// All patient routes require org membership
patientRoutes.use("*", requireAuth, requireOrg);

patientRoutes.get(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateQuery(paginationSchema),
  safe(patientController.list),
);

patientRoutes.get(
  "/:id",
  requireRole("owner", "admin", "doctor", "staff"),
  safe(patientController.getById),
);

patientRoutes.get(
  "/:id/bookings",
  requireRole("owner", "admin", "doctor", "staff"),
  safe(patientController.getBookings),
);

patientRoutes.post(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateBody(createPatientSchema),
  safe(patientController.create),
);

patientRoutes.patch(
  "/:id",
  requireRole("owner", "admin", "staff"),
  validateBody(updatePatientSchema),
  safe(patientController.update),
);

patientRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  safe(patientController.delete),
);

// ── Bookings ───────────────────────────────────────────────────────────────────
export const bookingRoutes = new Hono();

// All booking routes require org membership
bookingRoutes.use("*", requireAuth, requireOrg);

bookingRoutes.get(
  "/",
  requireRole("owner", "admin", "doctor", "staff"),
  validateQuery(bookingQuerySchema),
  safe(bookingController.list),
);

bookingRoutes.get("/:id", safe(bookingController.getById));

// Flat POST /bookings alias (doctorId comes from body)
bookingRoutes.post(
  "/",
  bookingLimiter,
  validateBody(
    createBookingSchema.extend({
      doctorId: z.string().uuid(),
    }),
  ),
  safe(async (c) => {
    const body = c.get("validatedBody");
    // Inject doctorId as a route param so bookingController.create can read it
    const originalParam = c.req.param.bind(c.req);
    (c.req as any).param = (key: string) =>
      key === "id" ? body.doctorId : originalParam(key);
    return bookingController.create(c);
  }),
);

bookingRoutes.patch(
  "/:id",
  requireRole("owner", "admin", "doctor", "staff"),
  validateBody(updateBookingSchema),
  safe(bookingController.update),
);

bookingRoutes.delete(
  "/:id",
  requireRole("owner", "admin"),
  safe(bookingController.delete),
);
