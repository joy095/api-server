import { Context } from "hono";

export function handleValidationError(result: any, c: Context) {
  if (result.success) return;

  const formattedErrors = result.error.map((err: any) => {
    // Extract the field name (e.g., "startDate")
    const path = err.path?.[0]?.key || "unknown";

    // Create a human-readable label (e.g., "StartDate")
    const fieldLabel = path.charAt(0).toUpperCase() + path.slice(1);

    // Determine the specific issue
    let message = `${fieldLabel} is invalid`;

    if (
      err.received === "undefined" ||
      err.received === "null" ||
      err.kind === "required"
    ) {
      message = `${fieldLabel} is required`;
    }

    return {
      path, // Machine-readable key (e.g., "startDate")
      message, // Human-readable message (e.g., "StartDate is required")
    };
  });

  return c.json(
    {
      success: false,
      errors: formattedErrors,
    },
    400,
  );
}
