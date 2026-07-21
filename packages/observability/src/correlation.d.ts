export type CorrelationContext = {
  correlationId: string;
};
export type CorrelationMiddleware = (req: unknown, res: unknown, next: () => void) => void;
export declare function generateCorrelationId(): string;
/**
 * Generic correlation ID middleware. Adapters (Fastify, Express, Nest)
 * wrap this with their own shape. Kept framework-agnostic on purpose.
 */
export declare function correlationIdMiddleware(
  req: {
    headers?: Record<string, string | string[] | undefined>;
  },
  res: {
    setHeader?: (k: string, v: string) => void;
    headers?: Record<string, string | string[] | undefined>;
  },
  next: () => void,
): string;
export declare function withCorrelationId<T>(_correlationId: string, fn: () => T): T;
//# sourceMappingURL=correlation.d.ts.map
