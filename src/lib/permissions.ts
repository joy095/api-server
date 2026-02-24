import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access";

/**
 * Merge the built-in org statements with any custom resource actions.
 * `as const` is required for TypeScript to infer literal types correctly.
 */
export const statement = {
  ...defaultStatements,
  // Custom resources for this app
  booking: ["create", "read", "update", "cancel", "delete"] as const,
  patient: ["create", "read", "update", "delete"] as const,
  doctor: ["create", "read", "update", "delete"] as const,
  availability: ["create", "read", "update", "delete"] as const,
} as const;

export const ac = createAccessControl(statement);

/** Clinic owner — full control */
export const owner = ac.newRole({
  ...ownerAc.statements,
  booking: ["create", "read", "update", "cancel", "delete"],
  patient: ["create", "read", "update", "delete"],
  doctor: ["create", "read", "update", "delete"],
  availability: ["create", "read", "update", "delete"],
});

/** Org admin — manage members + all resources, cannot delete org */
export const admin = ac.newRole({
  ...adminAc.statements,
  booking: ["create", "read", "update", "cancel", "delete"],
  patient: ["create", "read", "update", "delete"],
  doctor: ["create", "read", "update", "delete"],
  availability: ["create", "read", "update", "delete"],
});

/** Doctor — read all, write only their own availability/appointment types */
export const doctor = ac.newRole({
  ...memberAc.statements,
  booking: ["create", "read", "update", "cancel"],
  patient: ["read"],
  doctor: ["read"],
  availability: ["create", "read", "update", "delete"],
});

/** Staff — day-to-day ops, no structural changes */
export const staff = ac.newRole({
  ...memberAc.statements,
  booking: ["create", "read", "update", "cancel"],
  patient: ["create", "read", "update"],
  doctor: ["read"],
  availability: ["read"],
});
