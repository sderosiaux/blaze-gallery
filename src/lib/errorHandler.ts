/**
 * Global error handling utilities
 */

import { logger } from "./logger";

export interface ErrorContext {
  component?: string;
  operation?: string;
  userId?: string;
  requestId?: string;
  additionalData?: any;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: ErrorContext;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: ErrorContext,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 400, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(
    message: string = "Authentication required",
    context?: ErrorContext,
  ) {
    super(message, 401, true, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message: string = "Insufficient permissions",
    context?: ErrorContext,
  ) {
    super(message, 403, true, context);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", context?: ErrorContext) {
    super(message, 404, true, context);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource conflict", context?: ErrorContext) {
    super(message, 409, true, context);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded", context?: ErrorContext) {
    super(message, 429, true, context);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 502, true, context);
  }
}

/**
 * Central error handler
 */
export function handleError(error: Error, context?: ErrorContext): AppError {
  // If it's already an AppError, create new one with merged context
  if (error instanceof AppError) {
    return new AppError(
      error.message,
      error.statusCode,
      error.isOperational,
      context ? { ...error.context, ...context } : error.context,
    );
  }

  // Log the original error for debugging
  logger.error("Unhandled error converted to AppError", {
    component: context?.component || "Unknown",
    operation: context?.operation || "Unknown",
    originalError: error.message,
    stack: error.stack,
    context: context?.additionalData,
  });

  // Convert to AppError
  return new AppError(
    error.message || "An unexpected error occurred",
    500,
    false, // Non-operational since we don't know the nature
    context,
  );
}

/**
 * Error response helper for API routes
 */
export function createErrorResponse(
  error: Error | AppError,
  context?: ErrorContext,
) {
  const appError =
    error instanceof AppError ? error : handleError(error, context);

  // Log the error
  if (appError.isOperational) {
    logger.warn("Operational error occurred", {
      component: appError.context?.component || "API",
      operation: appError.context?.operation || "Unknown",
      error: appError.message,
      statusCode: appError.statusCode,
      context: appError.context,
    });
  } else {
    logger.error("Programming error occurred", {
      component: appError.context?.component || "API",
      operation: appError.context?.operation || "Unknown",
      error: appError.message,
      statusCode: appError.statusCode,
      stack: appError.stack,
      context: appError.context,
    });
  }

  return {
    success: false,
    error: appError.message,
    statusCode: appError.statusCode,
    // Include validation errors if it's a validation error
    ...(appError instanceof ValidationError &&
      appError.context?.additionalData?.validationErrors && {
        validationErrors: appError.context.additionalData.validationErrors,
      }),
  };
}

/**
 * Async wrapper to catch and handle errors
 */
export function asyncHandler(fn: Function) {
  return async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw handleError(error as Error);
    }
  };
}

/**
 * Initialize global error handlers
 */
export function initializeGlobalErrorHandlers(): void {
  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
    logger.error("Unhandled promise rejection", {
      component: "GlobalErrorHandler",
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
    });

    // In development, exit the process to make it obvious
    if (process.env.NODE_ENV === "development") {
      console.error("Unhandled promise rejection. Exiting process.");
      process.exit(1);
    }
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception", {
      component: "GlobalErrorHandler",
      error: error.message,
      stack: error.stack,
    });

    // Always exit on uncaught exceptions
    console.error("Uncaught exception. Exiting process.");
    process.exit(1);
  });

  // Handle graceful shutdown
  const gracefulShutdown = (signal: string) => {
    logger.info("Received shutdown signal", {
      component: "GlobalErrorHandler",
      signal,
    });

    // Give processes time to finish
    setTimeout(() => {
      logger.info("Graceful shutdown complete");
      process.exit(0);
    }, 5000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

/**
 * Retry mechanism for operations that might fail temporarily
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    backoff?: boolean;
    context?: ErrorContext;
  } = {},
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, backoff = true, context } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt > maxRetries) {
        break;
      }

      const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;

      logger.warn("Operation failed, retrying", {
        component: context?.component || "RetryMechanism",
        operation: context?.operation || "Unknown",
        attempt,
        maxRetries,
        delayMs: delay,
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw handleError(lastError!, {
    ...context,
    additionalData: {
      ...context?.additionalData,
      maxRetries,
      finalAttempt: true,
    },
  });
}
