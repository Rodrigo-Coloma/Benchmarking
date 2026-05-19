import pino from "pino";
import { loadEnv } from "./env.js";

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development" && {
    transport: {
      target: "pino/file",
      options: { destination: 1 },
    },
  }),
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "*.password"],
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
