import { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { Session, SessionUser } from "../types";

export type Variables = {
  session: Session;
  sessionUser: SessionUser;
};

declare module "hono" {
  interface ContextVariableMap extends Variables {}
}

export const requireSession: MiddlewareHandler = async (c: Context, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const res = await fetch(`${c.env.AUTH_SERVER}/api/auth/get-session`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text(); // debug log
    console.error("AUTH SERVER ERROR:", res.status, text);

    throw new HTTPException(401, { message: "Invalid session" });
  }

  const data = await res.json();

  const session: Session | undefined = data?.session;
  const user: SessionUser | undefined = data?.user;

  if (!session || !user) {
    throw new HTTPException(401, { message: "Session not found" });
  }

  // Expiry check
  if (new Date(session.expiresAt) < new Date()) {
    throw new HTTPException(401, { message: "Session expired" });
  }

  // Ban check
  if (user.banned) {
    throw new HTTPException(403, {
      message: user.banReason || "Account suspended",
    });
  }

  c.set("session", session);
  c.set("sessionUser", user);

  await next();
};
