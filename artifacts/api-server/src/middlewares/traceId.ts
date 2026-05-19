import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

declare module "express-serve-static-core" {
  interface Request {
    traceId: string;
  }
}

export const traceId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-trace-id");
  const id = incoming && /^[A-Za-z0-9-]{8,128}$/.test(incoming)
    ? incoming
    : randomUUID();
  req.traceId = id;
  res.setHeader("x-trace-id", id);
  next();
};
