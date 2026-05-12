import {
  check,
  forward,
  integer,
  isoDate,
  maxValue,
  minValue,
  nullable,
  number,
  object,
  optional,
  partialCheck,
  pipe,
  string,
  transform,
  type InferOutput,
} from "valibot";

// ─── Shared ───────────────────────────────────────────────────────────────────

const dateString = (field: string) =>
  pipe(
    string(),
    isoDate(`${field} is invalid`),
    transform((v) => new Date(v)),
  );

// ─── Doctor ───────────────────────────────────────────────────────────────────

export const CreateDoctorSchema = object({
  description: pipe(
    string(),
    check(
      (v) => v.trim().length > 10,
      "Description must be more than 10 chars",
    ),
  ),
  specialized: optional(
    nullable(
      pipe(
        string(),
        check((v) => v.length <= 100, "Max 100 chars"),
      ),
    ),
  ),
  slotDurationMins: optional(
    pipe(number(), integer(), minValue(5), maxValue(120)),
  ),
  image: optional(nullable(string())),
  slug: pipe(
    string(),
    check(
      (v) => v.trim().length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
      "Slug must be at least 3 chars, lowercase, and may contain hyphens",
    ),
  ),
});

export const UpdateDoctorSchema = object({
  description: optional(
    pipe(
      string(),
      check(
        (v) => v.trim().length > 10,
        "Description must be more than 10 chars",
      ),
    ),
  ),

  specialized: optional(
    nullable(
      pipe(
        string(),
        check((v) => v.length <= 100, "Max 100 chars"),
      ),
    ),
  ),
  image: optional(nullable(string())),
  slotDurationMins: optional(
    pipe(number(), integer(), minValue(5), maxValue(120)),
  ),

  slug: optional(
    pipe(
      string(),
      check(
        (v) => v.trim().length >= 3 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v),
        "Slug must be at least 3 chars, lowercase, and may contain hyphens",
      ),
    ),
  ),
});

// ─── Experience ───────────────────────────────────────────────────────────────

export const CreateExperienceSchema = pipe(
  object({
    organization: pipe(
      string(),
      check((v) => v.trim().length > 0, "Organization is required"),
      check((v) => v.length <= 255, "Max 255 chars"),
    ),
    description: optional(nullable(string())),
    image: optional(nullable(string())),
    startDate: dateString("StartDate"),
    endDate: optional(nullable(dateString("EndDate"))),
  }),

  forward(
    partialCheck(
      [["startDate"], ["endDate"]],
      (input) => {
        if (!input.endDate) return true;

        return input.endDate >= input.startDate;
      },
      "End date cannot be earlier than Start date",
    ),
    ["endDate"],
  ),
);

export const UpdateExperienceSchema = pipe(
  object({
    organization: optional(
      pipe(
        string(),
        check((v) => v.trim().length > 0, "Organization cannot be empty"),
        check((v) => v.length <= 255, "Max 255 chars"),
      ),
    ),
    description: optional(nullable(string())),
    image: optional(nullable(string())),
    startDate: optional(nullable(dateString("StartDate"))),
    endDate: optional(nullable(dateString("EndDate"))),
  }),

  forward(
    partialCheck(
      [["startDate"], ["endDate"]],
      (input) => {
        if (!input.startDate || !input.endDate) {
          return true;
        }

        return input.endDate >= input.startDate;
      },
      "EndDate cannot be earlier than StartDate",
    ),
    ["endDate"],
  ),
);

// ─── Certificate ──────────────────────────────────────────────────────────────

export const CreateCertificateSchema = pipe(
  object({
    name: pipe(
      string(),
      check((v) => v.trim().length > 0, "Name is required"),
      check((v) => v.length <= 255, "Max 255 chars"),
    ),
    description: optional(nullable(string())),
    image: optional(nullable(string())),
    issuedAt: dateString("IssuedAt"),
    expiresAt: optional(nullable(dateString("ExpiresAt"))),
  }),

  forward(
    partialCheck(
      [["issuedAt"], ["expiresAt"]],
      (input) => {
        if (!input.expiresAt) return true;

        return input.expiresAt >= input.issuedAt;
      },
      "Expires date cannot be earlier than Issued date",
    ),
    ["expiresAt"],
  ),
);

export const UpdateCertificateSchema = pipe(
  object({
    name: optional(
      pipe(
        string(),
        check((v) => v.trim().length > 0, "Name cannot be empty"),
        check((v) => v.length <= 255, "Max 255 chars"),
      ),
    ),
    description: optional(nullable(string())),
    image: optional(nullable(string())),
    issuedAt: optional(nullable(dateString("IssuedAt"))),
    expiresAt: optional(nullable(dateString("ExpiresAt"))),
  }),

  forward(
    partialCheck(
      [["issuedAt"], ["expiresAt"]],
      (input) => {
        if (!input.issuedAt || !input.expiresAt) {
          return true;
        }

        return input.expiresAt >= input.issuedAt;
      },
      "ExpiresAt cannot be earlier than IssuedAt",
    ),
    ["expiresAt"],
  ),
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateDoctorInput = InferOutput<typeof CreateDoctorSchema>;
export type UpdateDoctorInput = InferOutput<typeof UpdateDoctorSchema>;
export type CreateExperienceInput = InferOutput<typeof CreateExperienceSchema>;
export type UpdateExperienceInput = InferOutput<typeof UpdateExperienceSchema>;
export type CreateCertificateInput = InferOutput<
  typeof CreateCertificateSchema
>;
export type UpdateCertificateInput = InferOutput<
  typeof UpdateCertificateSchema
>;
