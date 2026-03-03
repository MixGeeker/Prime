/**
 * TypeORM（PostgreSQL）raw query 返回值解包工具。
 *
 * 背景：
 * - `EntityManager.query()` 在 Postgres 的 UPDATE/DELETE 语句上，会返回：
 *   `[rows, rowCount]`
 * - 但在 SELECT/INSERT（含 RETURNING）上，通常直接返回 `rows`
 *
 * 这里做一个兼容解包，避免把 `[rows, rowCount]` 当作 rows 进行 map/length。
 */
export function unwrapReturningRows<T>(queryResult: unknown): T[] {
  // UPDATE/DELETE: [rows, rowCount]
  if (
    Array.isArray(queryResult) &&
    queryResult.length === 2 &&
    Array.isArray(queryResult[0])
  ) {
    return queryResult[0] as T[];
  }

  // SELECT / INSERT ... RETURNING: rows
  return Array.isArray(queryResult) ? (queryResult as T[]) : [];
}

export function unwrapAffected(queryResult: unknown): number | null {
  if (Array.isArray(queryResult) && queryResult.length === 2) {
    const affected = (queryResult as unknown[])[1];
    const parsed = typeof affected === 'number' ? affected : Number(affected);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(queryResult)) {
    return queryResult.length;
  }
  return null;
}
