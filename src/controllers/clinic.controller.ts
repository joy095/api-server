import { Context } from "hono";
import { eq, sql, and, ilike } from "drizzle-orm";
import { clinic } from "../db/schema/schema";
import { ok, created, noContent, paginated, AppError } from "../lib/response";
import { createDb } from "../db";
import type { z } from "zod";
import type {
  createClinicSchema,
  updateClinicSchema,
  addClinicMemberSchema,
} from "../validators";
import type { AuthUser } from "../types";
import { member } from "../db/schema/auth-schema";

type CreateClinic = z.infer<typeof createClinicSchema>;
type UpdateClinic = z.infer<typeof updateClinicSchema>;
type AddClinicMember = z.infer<typeof addClinicMemberSchema>;

export const clinicController = {
  // GET /clinics
  list: async (c: Context) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const offset = (page - 1) * limit;

    const db = createDb(c.env);

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(clinic).limit(limit).offset(offset).orderBy(clinic.name),

      db.select({ count: sql<number>`count(*)::int` }).from(clinic),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /clinics/marketplace
  marketPlace: async (c: Context) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 20);
    const q = c.req.query("q")?.trim();
    const offset = (page - 1) * limit;

    const db = createDb(c.env);
    const whereClause = q ? ilike(clinic.name, `%${q}%`) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(clinic)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(clinic.name),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(clinic)
        .where(whereClause),
    ]);

    return paginated(c, rows, count, page, limit);
  },

  // GET /clinics/:id
  getById: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .select()
      .from(clinic)
      .where(eq(clinic.id, c.req.param("id")))
      .limit(1);

    if (!row) throw new AppError("Clinic not found", 404);
    return ok(c, row);
  },

  // POST /clinics
  create: async (c: Context) => {
    const body: CreateClinic = c.get("validatedBody");
    const user = c.get("user") as AuthUser;
    const db = createDb(c.env);

    const [row] = await db.insert(clinic).values(body).returning();

    // Ensure creator has owner role in their active organization.
    if (user?.organizationId) {
      await db
        .update(member)
        .set({ role: "owner" })
        .where(
          and(
            eq(member.organizationId, user.organizationId),
            eq(member.userId, user.id),
          ),
        );
    }

    return created(c, row);
  },

  // POST /clinics/:id/members
  addMember: async (c: Context) => {
    const body: AddClinicMember = c.get("validatedBody");
    const user = c.get("user") as AuthUser;

    if (!user?.organizationId) {
      throw new AppError("No active organisation", 403, "NO_ACTIVE_ORG");
    }

    const db = createDb(c.env);

    const [existing] = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, user.organizationId),
          eq(member.userId, body.userId),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(member)
        .set({ role: body.role })
        .where(eq(member.id, existing.id))
        .returning({ id: member.id, role: member.role, userId: member.userId });

      return ok(c, {
        message: "Clinic member role updated",
        member: updated,
      });
    }

    throw new AppError(
      "User is not a member of the active organisation",
      404,
      "MEMBER_NOT_FOUND",
    );
  },

  // PATCH /clinics/:id
  update: async (c: Context) => {
    const body: UpdateClinic = c.get("validatedBody");
    const db = createDb(c.env);

    const [row] = await db
      .update(clinic)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(clinic.id, c.req.param("id")))
      .returning();

    if (!row) throw new AppError("Clinic not found", 404);
    return ok(c, row);
  },

  // DELETE /clinics/:id
  delete: async (c: Context) => {
    const db = createDb(c.env);

    const [row] = await db
      .delete(clinic)
      .where(eq(clinic.id, c.req.param("id")))
      .returning({ id: clinic.id });

    if (!row) throw new AppError("Clinic not found", 404);
    return noContent(c);
  },
};
