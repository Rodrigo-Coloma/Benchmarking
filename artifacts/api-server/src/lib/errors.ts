export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INSUFFICIENT_ROLE"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_SLUG_TAKEN"
  | "KPI_NOT_FOUND"
  | "KPI_DUPLICATE"
  | "EXCEL_PARSE_FAILED"
  | "EXCEL_NO_CHANGES"
  | "INGESTION_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "INVITATION_INVALID"
  | "INVITATION_EXPIRED"
  | "VALIDATION_FAILED"
  | "RAG_UNAVAILABLE"
  | "AGENT_FAILED"
  | "INTERNAL_ERROR"
  | "USER_EXISTS"
  | "BAD_CREDENTIALS"
  | "API_KEY_INVALID";

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, 404, details);
  }
}

export class ConflictError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, 409, details);
  }
}

export class ValidationError extends DomainError {
  constructor(details: unknown, message = "Validation failed") {
    super("VALIDATION_FAILED", message, 422, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(code: ErrorCode = "FORBIDDEN", message = "Forbidden") {
    super(code, message, 403);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Unauthenticated") {
    super("UNAUTHENTICATED", message, 401);
  }
}
