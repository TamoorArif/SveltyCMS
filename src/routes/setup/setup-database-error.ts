/**
 * @file src/routes/setup/setup-database-error.ts
 * @description Custom error class for structured, type-safe database setup errors.
 */

export type DbErrorClassification =
  | "CONNECTION_REFUSED"
  | "AUTH_FAILED"
  | "DB_NOT_FOUND"
  | "HOST_UNREACHABLE"
  | "INVALID_CONFIG"
  | "DRIVER_MISSING"
  | "PERMISSION_DENIED"
  | "UNKNOWN";

export interface ClassifiedError {
  classification: DbErrorClassification;
  userFriendly: string;
  hint?: string;
  raw: string;
}

/**
 * Custom error class used during the setup wizard to provide
 * structured feedback to the frontend.
 */
export class SetupDatabaseError extends Error {
  public readonly classification: DbErrorClassification;
  public readonly hint?: string;
  public readonly userFriendly: string;
  public readonly details?: unknown;

  constructor(classified: ClassifiedError, originalError?: unknown) {
    // Use the user-friendly message as the primary error message
    super(classified.userFriendly);
    this.name = "SetupDatabaseError";
    this.classification = classified.classification;
    this.userFriendly = classified.userFriendly;
    this.hint = classified.hint;

    // Preserve original error details for server-side logging
    if (originalError) {
      this.cause = originalError;
      // Extract specifics if available (e.g., MongoDB error codes)
      this.details =
        originalError instanceof Error
          ? {
              message: originalError.message,
              name: originalError.name,
              stack: process.env.NODE_ENV === "development" ? originalError.stack : undefined,
            }
          : originalError;
    }

    // Ensure proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SetupDatabaseError);
    }
  }

  /**
   * Sanitizes the error for transmission to the client.
   * Excludes sensitive details like internal stack traces.
   */
  public toClientPayload() {
    return {
      success: false,
      error: this.userFriendly,
      classification: this.classification,
      hint: this.hint,
      // We only send dbDoesNotExist flag for specific classification to trigger UI modals
      dbDoesNotExist: this.classification === "DB_NOT_FOUND",
    };
  }

  /**
   * Static helper to wrap any error into a SetupDatabaseError using a classifier.
   */
  public static fromError(
    error: unknown,
    classifier: (err: unknown) => ClassifiedError,
  ): SetupDatabaseError {
    if (error instanceof SetupDatabaseError) return error;
    return new SetupDatabaseError(classifier(error), error);
  }
}
