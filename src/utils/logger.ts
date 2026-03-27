import { mkdirSync } from "fs";
import { dirname } from "path";
import winston from "winston";
import { Config } from "../config.js";

const { combine, timestamp, json, colorize, simple } = winston.format;

// Ensure log directory exists
try {
  mkdirSync(dirname(Config.logging.file), { recursive: true });
} catch {
  /* directory already exists */
}

const logger = winston.createLogger({
  level: Config.logging.level,
  format: combine(timestamp(), json()),
  transports: [
    new winston.transports.Console({
      format: process.stdout.isTTY
        ? combine(colorize(), simple())
        : combine(timestamp(), json()),
    }),
    new winston.transports.File({
      filename: Config.logging.file,
      format: combine(timestamp(), json()),
    }),
  ],
});

export { logger };
