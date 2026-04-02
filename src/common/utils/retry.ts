import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  factor?: number;
  label?: string;
  logger?: Logger;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    factor = 2,
    label = 'Operation',
    logger,
  } = options;

  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        logger?.error(
          `${label} failed after ${maxAttempts} attempts: ${(error as Error).message}`,
        );
        throw error;
      }
      logger?.warn(
        `${label} attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms... (${(error as Error).message})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= factor;
    }
  }

  // unreachable
  throw new Error('withRetry: exhausted attempts');
}
