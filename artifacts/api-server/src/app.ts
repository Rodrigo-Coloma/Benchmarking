import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";

import { loadEnv } from "./env.js";
import { logger } from "./logger.js";
import { traceId } from "./middlewares/traceId.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { buildRouter } from "./routes/index.js";

export function buildApp(): Express {
  const env = loadEnv();
  const app = express();
  const basePath = env.BASE_PATH === "/" ? "" : env.BASE_PATH;

  app.set("trust proxy", 1);
  app.set("basePath", basePath);
  app.set("cookieName", env.COOKIE_NAME);

  app.use(
    helmet({
      contentSecurityPolicy:
        env.NODE_ENV === "production"
          ? {
              useDefaults: true,
              directives: {
                "default-src": ["'self'"],
                "img-src": ["'self'", "data:"],
                "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
                "style-src": [
                  "'self'",
                  "'unsafe-inline'",
                  "https://fonts.googleapis.com",
                ],
                "connect-src": ["'self'"],
              },
            }
          : false,
    }),
  );
  app.use(compression());
  app.use(traceId);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        traceId: (req as { traceId?: string }).traceId,
      }),
    }),
  );
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    session({
      name: env.COOKIE_NAME,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        path: basePath || "/",
        domain: env.COOKIE_DOMAIN,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // Rate-limit suave en /auth/* (incluido login y signup)
  app.use(
    `${basePath}/api/auth/login`,
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use(`${basePath}/api`, buildRouter());

  // 404 JSON
  app.use(`${basePath}/api`, (_req, res) => {
    res.status(404).json({
      error: "Not found",
      code: "INTERNAL_ERROR",
      details: null,
    });
  });

  app.use(errorHandler);

  return app;
}
