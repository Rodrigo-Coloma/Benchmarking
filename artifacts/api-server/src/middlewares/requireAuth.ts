import type { RequestHandler } from "express";
import { UnauthenticatedError } from "../lib/errors.js";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      name: string;
    };
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.session?.user) {
    return next(new UnauthenticatedError("No autenticado"));
  }
  return next();
};
