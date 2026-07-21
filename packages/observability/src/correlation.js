import { nanoid } from "nanoid";
export function generateCorrelationId() {
  return nanoid(16);
}
/**
 * Generic correlation ID middleware. Adapters (Fastify, Express, Nest)
 * wrap this with their own shape. Kept framework-agnostic on purpose.
 */
export function correlationIdMiddleware(req, res, next) {
  const incoming =
    readHeader(req.headers, "x-correlation-id") ?? readHeader(req.headers, "x-request-id");
  const correlationId = isValidCorrelationId(incoming) ? incoming : generateCorrelationId();
  if (res.setHeader) {
    res.setHeader("x-correlation-id", correlationId);
  } else if (res.headers) {
    res.headers["x-correlation-id"] = correlationId;
  }
  req.correlationId = correlationId;
  next();
  return correlationId;
}
export function withCorrelationId(_correlationId, fn) {
  return fn();
}
const VALID_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
function isValidCorrelationId(value) {
  return typeof value === "string" && VALID_CORRELATION_ID.test(value);
}
function readHeader(headers, name) {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}
//# sourceMappingURL=correlation.js.map
