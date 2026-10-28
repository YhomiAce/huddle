/**
 * An expected, user-facing error. The HTTP layer and the socket layer both turn it into
 * a clean `{ error: { code, message } }` payload; anything else becomes a generic 500.
 */
export class AppError extends Error {
  /**
   * @param status - HTTP status code to respond with.
   * @param code - Stable machine-readable code, e.g. `not_found`.
   * @param message - Human-readable explanation, safe to show to users.
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Shape of every error payload sent to clients. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Converts any thrown value into a safe status + body pair, logging unexpected errors.
 *
 * @param err - The thrown value.
 * @returns The HTTP status and the JSON body to send.
 */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  console.error("Unexpected error:", err);
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong." } } };
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found.`);
export const forbidden = (message: string) => new AppError(403, "forbidden", message);
export const badRequest = (message: string) => new AppError(400, "bad_request", message);
