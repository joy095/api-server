import { Context, Next } from "hono";
import { AppError } from "../lib/response";
import type { AuthUser } from "../types";

/**
 * Ensures a doctor-role user can only modify their own resources.
 * Admins (org-scoped "admin" or "owner") and staff bypass this check.
 *
 * Usage: place AFTER requireAuth on doctor-scoped routes.
 * The route must have a :id param that represents the doctorId.
 */
export const requireSelfOrAdmin = async (c: Context, next: Next) => {
  const user: AuthUser = c.get("user");

  if (!user) throw new AppError("Unauthorized", 401);

  // Owners and admins can access any doctor's resources within the org
  if (user.role === "owner" || user.role === "admin" || user.role === "staff") {
    return next();
  }

  // Doctors can only access their own resources
  if (user.role === "doctor") {
    const paramDoctorId = c.req.param("id");

    if (!user.doctorId) {
      throw new AppError(
        "Your account is not linked to a doctor profile",
        403,
        "NO_DOCTOR_LINK",
      );
    }

    if (user.doctorId !== paramDoctorId) {
      throw new AppError(
        "Forbidden: you can only manage your own resources",
        403,
        "SELF_ONLY",
      );
    }

    return next();
  }

  throw new AppError("Forbidden", 403);
};
