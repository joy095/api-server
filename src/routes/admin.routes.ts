import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "../db";
import { user } from "../db/schema/auth-schema";
import { member } from "../db/schema/auth-schema";
import { requireAuth, requireOrg, requireRole, validateBody } from "../middlewares";
import { ok, noContent, paginated, AppError } from "../lib/response";

export const adminRoutes = new Hono();

// All admin routes require auth + org + owner/admin role
adminRoutes.use("*", requireAuth, requireOrg, requireRole("owner", "admin"));

const updateUserRoleSchema = z.object({
  /** Org-scoped role to assign */
  role: z.enum(["owner", "admin", "doctor", "staff"]),
  /** Link to a doctor profile row (required when role = "doctor") */
  doctorId: z.string().uuid().optional().nullable(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "doctor", "staff"]),
});

// ── GET /admin/users ───────────────────────────────────────────────────────────
// Lists all users who are members of the active organisation.
adminRoutes.get("/users", async (c) => {
  const db = createDb(c.env);
  const orgId = (c.get("user") as any).organizationId as string;

  const page = Number(c.req.query("page") ?? 1);
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = (page - 1) * limit;

  // Join member → user to list only members of this org
  const rows = await db
    .select({
      memberId: member.id,
      role: member.role,
      joinedAt: member.createdAt,
      userId: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      doctorId: user.doctorId,
      createdAt: user.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId))
    .orderBy(member.createdAt)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, orgId));

  return paginated(c, rows, count, page, limit);
});

// ── GET /admin/users/:id ───────────────────────────────────────────────────────
adminRoutes.get("/users/:id", async (c) => {
  const db = createDb(c.env);
  const orgId = (c.get("user") as any).organizationId as string;

  const [row] = await db
    .select({
      memberId: member.id,
      role: member.role,
      userId: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      doctorId: user.doctorId,
      createdAt: user.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      sql`member.user_id = ${c.req.param("id")} AND member.organization_id = ${orgId}`,
    )
    .limit(1);

  if (!row) throw new AppError("User not found in this organisation", 404);
  return ok(c, row);
});

// ── PATCH /admin/users/:id/role ────────────────────────────────────────────────
// Updates the member's org-scoped role AND optionally links a doctor profile.
adminRoutes.patch(
  "/users/:id/role",
  validateBody(updateUserRoleSchema),
  async (c) => {
    const db = createDb(c.env);
    const orgId = (c.get("user") as any).organizationId as string;
    const { role, doctorId } = c.get("validatedBody");

    // Update the member role (org-scoped)
    const [updatedMember] = await db
      .update(member)
      .set({ role })
      .where(
        sql`member.user_id = ${c.req.param("id")} AND member.organization_id = ${orgId}`,
      )
      .returning({ id: member.id, role: member.role });

    if (!updatedMember) throw new AppError("Member not found", 404);

    // Also update the global user.doctorId if supplied explicitly,
    // or auto-clear it when the role is no longer "doctor"
    const doctorIdUpdate =
      doctorId !== undefined
        ? doctorId ?? null           // explicit value (or explicit null) from caller
        : role !== "doctor"
          ? null                     // role changed away from doctor — clear the link
          : undefined;               // role is still doctor, no change requested

    if (doctorIdUpdate !== undefined) {
      await db
        .update(user)
        .set({ doctorId: doctorIdUpdate, updatedAt: new Date() })
        .where(eq(user.id, c.req.param("id")));
    }

    return ok(c, { ...updatedMember, doctorId });
  },
);

// ── DELETE /admin/users/:id ────────────────────────────────────────────────────
// Removes the user from this org (does NOT delete the global user account).
adminRoutes.delete("/users/:id", async (c) => {
  const currentUser = c.get("user") as any;
  if (currentUser.id === c.req.param("id")) {
    throw new AppError("You cannot remove yourself from the organisation", 400);
  }

  const db = createDb(c.env);
  const orgId = currentUser.organizationId as string;

  const [deleted] = await db
    .delete(member)
    .where(
      sql`user_id = ${c.req.param("id")} AND organization_id = ${orgId}`,
    )
    .returning({ id: member.id });

  if (!deleted) throw new AppError("Member not found", 404);
  return noContent(c);
});

// ── GET /admin/stats ───────────────────────────────────────────────────────────
// Org-scoped summary statistics.
adminRoutes.get("/stats", async (c) => {
  const db = createDb(c.env);
  const orgId = (c.get("user") as any).organizationId as string;

  const [memberCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, orgId));

  // Booking stats are not org-scoped yet in the schema, but we can filter
  // by clinicId membership once the org→clinic link is established.
  const [bookingStats] = await db.execute(sql`
    SELECT
      (SELECT reltuples::bigint FROM pg_class WHERE relname = 'doctor')   AS total_doctors,
      (SELECT reltuples::bigint FROM pg_class WHERE relname = 'clinic')   AS total_clinics,
      (SELECT reltuples::bigint FROM pg_class WHERE relname = 'patients') AS total_patients,
      (SELECT COUNT(*)::int FROM booking WHERE booking_status = 'pending') AS pending_bookings,
      (SELECT COUNT(*)::int FROM booking WHERE serial_date = CURRENT_DATE) AS bookings_today
  `);

  return ok(c, {
    organisation: { id: orgId, memberCount: memberCount?.count ?? 0 },
    ...bookingStats,
  });
});
