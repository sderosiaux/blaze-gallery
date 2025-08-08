/**
 * Input validation utilities for API endpoints
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "array" | "object";
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  allowedValues?: any[];
  customValidator?: (value: any) => string | null;
}

export function validateInput(
  data: any,
  rules: ValidationRule[],
): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    const value = data?.[rule.field];
    const fieldName = rule.field;

    // Check required fields
    if (
      rule.required &&
      (value === undefined || value === null || value === "")
    ) {
      errors.push(`${fieldName} is required`);
      continue;
    }

    // Skip validation if field is optional and not provided
    if (!rule.required && (value === undefined || value === null)) {
      continue;
    }

    // Type validation
    if (rule.type && value !== undefined && value !== null) {
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (actualType !== rule.type) {
        errors.push(`${fieldName} must be of type ${rule.type}`);
        continue;
      }
    }

    // String validations
    if (rule.type === "string" && typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        errors.push(
          `${fieldName} must be at least ${rule.minLength} characters long`,
        );
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        errors.push(
          `${fieldName} must be no more than ${rule.maxLength} characters long`,
        );
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        errors.push(`${fieldName} format is invalid`);
      }
    }

    // Number validations
    if (rule.type === "number" && typeof value === "number") {
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`${fieldName} must be at least ${rule.min}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`${fieldName} must be no more than ${rule.max}`);
      }
    }

    // Allowed values validation
    if (rule.allowedValues && !rule.allowedValues.includes(value)) {
      errors.push(
        `${fieldName} must be one of: ${rule.allowedValues.join(", ")}`,
      );
    }

    // Custom validation
    if (rule.customValidator) {
      const customError = rule.customValidator(value);
      if (customError) {
        errors.push(`${fieldName}: ${customError}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Common validation patterns
export const ValidationPatterns = {
  URL: /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  S3_KEY: /^[a-zA-Z0-9!_.*'()\/-]+$/,
  FOLDER_PATH: /^[a-zA-Z0-9_.\-\/]*$/,
  FILENAME: /^[a-zA-Z0-9_.\-\s()]+\.[a-zA-Z0-9]+$/,
};

// Common validators
export const CommonValidators = {
  positiveInteger: (value: any): string | null => {
    if (!Number.isInteger(value) || value <= 0) {
      return "must be a positive integer";
    }
    return null;
  },

  validUrl: (value: any): string | null => {
    if (typeof value !== "string") return "must be a string";
    try {
      new URL(value);
      return null;
    } catch {
      return "must be a valid URL";
    }
  },

  nonEmptyString: (value: any): string | null => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return "must be a non-empty string";
    }
    return null;
  },

  validFilePath: (value: any): string | null => {
    if (typeof value !== "string") return "must be a string";
    if (value.includes("..") || value.includes("//")) {
      return "contains invalid path characters";
    }
    return null;
  },
};

// Sanitization utilities
export function sanitizeString(input: string, maxLength: number = 255): string {
  return input.trim().substring(0, maxLength);
}

export function sanitizeInteger(input: any, defaultValue: number = 0): number {
  const parsed = parseInt(input);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function sanitizeBoolean(
  input: any,
  defaultValue: boolean = false,
): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    return input.toLowerCase() === "true" || input === "1";
  }
  return defaultValue;
}

// Rate limiting helpers (for future implementation)
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
}

export function createRateLimitKey(
  identifier: string,
  endpoint: string,
): string {
  return `ratelimit:${endpoint}:${identifier}`;
}
