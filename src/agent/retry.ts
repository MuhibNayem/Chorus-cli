export interface RetryPolicy {
  maxAttempts: number;
  shouldRetry(error: Error, attempt: number): boolean;
  delayMs(attempt: number): number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  shouldRetry: (error, attempt) =>
    attempt < 2 && /429|503|temporar|timeout|timed out/i.test(error.message),
  delayMs: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
};

export async function withRetry<T>(
  action: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<{ value: T; attempts: number }> {
  let attempt = 0;

  while (true) {
    try {
      return { value: await action(), attempts: attempt + 1 };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (attempt + 1 >= policy.maxAttempts || !policy.shouldRetry(err, attempt + 1)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, policy.delayMs(attempt + 1)));
      attempt += 1;
    }
  }
}
