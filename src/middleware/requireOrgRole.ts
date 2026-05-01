import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createDb } from "../db";
import { member } from "../db/schema/auth-schema";
import { eq, and } from "drizzle-orm";
import { Bindings } from "..";

type AppEnv = { Bindings: Bindings };

// You can extend roles if needed
type Role = "owner" | "admin" | "member";

export const requireOrgRole = (requiredRole: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const db = createDb(c.env);

    const authUser = c.get("sessionUser");
    const session = c.get("session");

    const orgId = session.activeOrganizationId;

    if (!orgId) {
      throw new HTTPException(400, { message: "No active organization" });
    }

    const membership = await db.query.member.findFirst({
      where: and(
        eq(member.organizationId, orgId),
        eq(member.userId, authUser.id),
      ),
    });

    if (!membership) {
      throw new HTTPException(403, { message: "Not a member" });
    }

    // Role hierarchy (optional but recommended)
    const rolePriority: Record<Role, number> = {
      owner: 3,
      admin: 2,
      member: 1,
    };

    if (rolePriority[membership.role as Role] < rolePriority[requiredRole]) {
      throw new HTTPException(403, {
        message: `Requires ${requiredRole} role`,
      });
    }

    // Attach useful data to context (optional but powerful)
    c.set("orgId", orgId);
    c.set("membership", membership);

    await next();
  });
