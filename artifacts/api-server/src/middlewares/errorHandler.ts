import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError, ValidationError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const traceId = (req as { traceId?: string }).traceId;

  if (err instanceof ZodError) {
    err = new ValidationError(err.flatten());
  }

  if (err instanceof DomainError) {
    req.log?.warn?.(
      { code: err.code, traceId, details: err.details },
      err.message,
    );
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details ?? null,
      traceId,
    });
    return;
  }

  req.log?.error?.({ err, traceId }, "Unhandled error");
  res.status(500).json({
    error: "Internal error",
    code: "INTERNAL_ERROR",
    details: null,
    traceId,
  });
};
