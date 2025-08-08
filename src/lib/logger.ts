export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

import {
  BaseLogContext,
  S3LogContext,
  SyncLogContext,
  ThumbnailLogContext,
  DatabaseLogContext,
  ApiLogContext,
  ConfigLogContext,
} from "@/types/common";

export interface LogContext extends BaseLogContext {
  userId?: string;
  requestId?: string;
  [key: string]: any;
}

class Logger {
  private logLevel: LogLevel;
  private isDevelopment: boolean;

  constructor() {
    this.logLevel = this.getLogLevelFromEnv();
    this.isDevelopment = process.env.NODE_ENV === "development";
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase();
    switch (level) {
      case "DEBUG":
        return LogLevel.DEBUG;
      case "INFO":
        return LogLevel.INFO;
      case "WARN":
        return LogLevel.WARN;
      case "ERROR":
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(
    level: string,
    message: string,
    context?: LogContext,
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] ${level}: ${message}${contextStr}`;
  }

  private logWithLevel(
    level: LogLevel,
    levelName: string,
    message: string,
    context?: LogContext,
    error?: Error,
  ) {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(levelName, message, context);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        if (error) console.warn(error.stack);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage);
        if (error) console.error(error.stack);
        break;
    }
  }

  debug(message: string, context?: LogContext) {
    this.logWithLevel(LogLevel.DEBUG, "DEBUG", message, context);
  }

  info(message: string, context?: LogContext) {
    this.logWithLevel(LogLevel.INFO, "INFO", message, context);
  }

  warn(message: string, context?: LogContext, error?: Error) {
    this.logWithLevel(LogLevel.WARN, "WARN", message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error) {
    this.logWithLevel(LogLevel.ERROR, "ERROR", message, context, error);
  }

  // Specialized logging methods for common scenarios

  s3Connection(message: string, context?: S3LogContext) {
    this.info(`[S3] ${message}`);
  }

  s3Error(message: string, error: Error, context?: S3LogContext) {
    this.logWithLevel(
      LogLevel.ERROR,
      "ERROR",
      `[S3] ${message}`,
      undefined,
      error,
    );
  }

  syncOperation(message: string, context?: SyncLogContext) {
    this.info(`[SYNC] ${message}`);
  }

  syncError(message: string, error: Error, context?: SyncLogContext) {
    this.logWithLevel(LogLevel.ERROR, "ERROR", `[SYNC] ${message}`, undefined, error);
  }

  thumbnailOperation(message: string, context?: ThumbnailLogContext) {
    this.info(`[THUMBNAIL] ${message}`, {
      component: "ThumbnailService",
      ...context,
    });
  }

  thumbnailError(message: string, error: Error, context?: ThumbnailLogContext) {
    this.error(
      `[THUMBNAIL] ${message}`,
      { component: "ThumbnailService", ...context },
      error,
    );
  }

  dbOperation(message: string, context?: DatabaseLogContext) {
    this.debug(`[DB] ${message}`, { component: "Database", ...context });
  }

  dbError(message: string, error: Error, context?: DatabaseLogContext) {
    this.error(`[DB] ${message}`, { component: "Database", ...context }, error);
  }

  apiRequest(message: string, context?: ApiLogContext) {
    this.info(`[API] ${message}`, { component: "API", ...context });
  }

  apiError(message: string, error: Error, context?: ApiLogContext) {
    this.error(`[API] ${message}`, { component: "API", ...context }, error);
  }

  configOperation(message: string, context?: ConfigLogContext) {
    this.info(`[CONFIG] ${message}`, { component: "Config", ...context });
  }

  configError(message: string, error: Error, context?: ConfigLogContext) {
    this.error(
      `[CONFIG] ${message}`,
      { component: "Config", ...context },
      error,
    );
  }
}

export const logger = new Logger();
