import { Hono } from "hono";
import { Bindings } from "..";
import { requireOrgRole } from "../middleware/requireOrgRole";
import { requireSession } from "../middleware/sessionMiddleware";
import {
  check,
  integer,
  maxValue,
  minValue,
  number,
  object,
  picklist,
  pipe,
  string,
  uuid,
} from "valibot";

// ─── Controllers ──────────────────────────────────────────────────────────────

import {
  createAppointment,
  getMyAppointments,
  getDoctorAppointments,
  getAppointment,
  updateAppointmentStatus,
  deleteAppointment,
} from "../controllers/appointment.controller";
import {
  deleteOrgImage,
  uploadOrgImage,
} from "../controllers/org-Image.controller";
import { validateBody } from "../utils/v";

type AppEnv = { Bindings: Bindings };

const orgRoute = new Hono<AppEnv>();

// ─── Validators ───────────────────────────────────────────────────────────────

const CreateAppointmentSchema = object({
  doctorId: pipe(string(), uuid()),
  bookingDate: pipe(
    string(),
    check((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Must be YYYY-MM-DD"),
  ),
  numberOfPatients: pipe(number(), integer(), minValue(1), maxValue(10)),
  appointmentDate: string(),
});

const UpdateAppointmentStatusSchema = object({
  status: picklist([
    "waiting",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ]),
});

// ─── Organization Image ─────────────────────────────────────────────────────────────

orgRoute.post(
  "/image",
  requireSession,
  requireOrgRole("owner"),
  uploadOrgImage,
);

orgRoute.delete(
  "/image",
  requireSession,
  requireOrgRole("owner"),
  deleteOrgImage,
);

// ─────────────────────────────────────────────────────────────────────────────
// APPOINTMENT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

orgRoute.post(
  "/appointment",
  requireSession,
  validateBody(CreateAppointmentSchema),
  createAppointment,
);

orgRoute.get("/appointment/my", requireSession, getMyAppointments);

orgRoute.get(
  "/appointment/doctor/:doctorId/:date",
  requireSession,
  getDoctorAppointments,
);

orgRoute.get("/appointment/:id", requireSession, getAppointment);

orgRoute.patch(
  "/appointment/:id/status",
  requireSession,
  validateBody(UpdateAppointmentStatusSchema),
  updateAppointmentStatus,
);

orgRoute.delete("/appointment/:id", requireSession, deleteAppointment);

export default orgRoute;
