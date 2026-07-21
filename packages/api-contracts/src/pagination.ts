import { z } from "zod";

export const PageInfoSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;

export type PaginatedResponse<T> = {
  data: ReadonlyArray<T>;
  meta: {
    nextCursor?: string;
    total?: number;
  };
};

export function buildPaginatedResponse<T>(
  items: ReadonlyArray<T>,
  nextCursor?: string,
  total?: number,
): PaginatedResponse<T> {
  const meta: { nextCursor?: string; total?: number } = {};
  if (nextCursor !== undefined) meta.nextCursor = nextCursor;
  if (total !== undefined) meta.total = total;
  return { data: items, meta };
}

export const CursorSchema = z.object({
  value: z.string().min(1),
  op: z.enum(["after", "before"]).default("after"),
});

export type Cursor = z.infer<typeof CursorSchema>;
