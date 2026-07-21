import { nanoid } from "nanoid";

export type CorrelationContext = {
  correlationId: string;
};

export type CorrelationMiddleware = (req: unknown, res: unknown, next: () => void) => void;

export function generateCorrelationId(): string {
  return nanoid(16);
}

/**
 * Generic correlation ID middleware. Adapters (Fastify, Express, Nest)
 * wrap this with their own shape. Kept framework-agnostic on purpose.
 */
export function correlationIdMiddleware(
  req: { headers?: Record<string, string | string[] | undefined> },
  res: {
    setHeader?: (k: string, v: string) => void;
    headers?: Record<string, string | string[] | undefined>;
  },
  next: () => void,
): string {
  const incoming =
    readHeader(req.headers, "x-correlation-id") ?? readHeader(req.headers, "x-request-id");
  const correlationId = isValidCorrelationId(incoming)
    ? (incoming as string)
    : generateCorrelationId();
  if (res.setHeader) {
    res.setHeader("x-correlation-id", correlationId);
  } else if (res.headers) {
    res.headers["x-correlation-id"] = correlationId;
  }
  (req as { correlationId?: string }).correlationId = correlationId;
  next();
  return correlationId;
}

export function withCorrelationId<T>(_correlationId: string, fn: () => T): T {
  return fn();
}

const VALID_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isValidCorrelationId(value: string | undefined): value is string {
  return typeof value === "string" && VALID_CORRELATION_ID.test(value);
}

function readHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}
