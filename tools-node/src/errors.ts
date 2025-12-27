/**
 * TiaCC Error Handling Module
 * Provides unified error types and handling utilities
 */

/**
 * Base error class for TiaCC
 */
export class TiaError extends Error {
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    options: {
      recoverable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'TiaError';
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.context = options.context;
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      context: this.context,
    };
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends TiaError {
  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, 'DB_ERROR', { recoverable: false, context, cause });
    this.name = 'DatabaseError';
  }
}

/**
 * Coverage parsing errors
 */
export class CoverageParseError extends TiaError {
  constructor(message: string, filePath: string, cause?: Error) {
    super(message, 'COVERAGE_PARSE_ERROR', {
      recoverable: true,
      context: { filePath },
      cause,
    });
    this.name = 'CoverageParseError';
  }
}

/**
 * Git operation errors
 */
export class GitError extends TiaError {
  constructor(message: string, operation: string, cause?: Error) {
    super(message, 'GIT_ERROR', {
      recoverable: true,
      context: { operation },
      cause,
    });
    this.name = 'GitError';
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends TiaError {
  constructor(message: string, configKey?: string) {
    super(message, 'CONFIG_ERROR', {
      recoverable: false,
      context: configKey ? { configKey } : undefined,
    });
    this.name = 'ConfigError';
  }
}

/**
 * IPC connection errors
 */
export class IpcError extends TiaError {
  constructor(message: string, host: string, port: number, cause?: Error) {
    super(message, 'IPC_ERROR', {
      recoverable: true,
      context: { host, port },
      cause,
    });
    this.name = 'IpcError';
  }
}

/**
 * Error handler utility
 */
export function handleError(error: unknown, options: {
  exitOnFatal?: boolean;
  silent?: boolean;
} = {}): void {
  const { exitOnFatal = true, silent = false } = options;

  if (error instanceof TiaError) {
    if (!silent) {
      console.error(`[${error.code}] ${error.message}`);
      if (error.context) {
        console.error('Context:', JSON.stringify(error.context, null, 2));
      }
    }

    if (!error.recoverable && exitOnFatal) {
      process.exit(1);
    }
  } else if (error instanceof Error) {
    if (!silent) {
      console.error(`[UNKNOWN_ERROR] ${error.message}`);
    }
    if (exitOnFatal) {
      process.exit(1);
    }
  } else {
    if (!silent) {
      console.error(`[UNKNOWN_ERROR] ${String(error)}`);
    }
    if (exitOnFatal) {
      process.exit(1);
    }
  }
}

/**
 * Wrap async function with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorHandler?: (error: unknown) => void
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (errorHandler) {
        errorHandler(error);
      } else {
        handleError(error);
      }
      throw error;
    }
  }) as T;
}

/**
 * Format error message for user display
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof TiaError) {
    let msg = `Error: ${error.message}`;
    if (error.context) {
      const contextStr = Object.entries(error.context)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      msg += ` (${contextStr})`;
    }
    return msg;
  } else if (error instanceof Error) {
    return `Error: ${error.message}`;
  } else {
    return `Error: ${String(error)}`;
  }
}
