/**
 * Hito 4.3.3 — Paginacion basada en cursor (keyset pagination).
 *
 * Mucho mas eficiente que OFFSET/LIMIT cuando hay millones de filas:
 * en vez de tirar OFFSET 100000 (Postgres lee y descarta 100k filas),
 * filtramos por (created_at, id) > cursor.
 *
 * El cursor es un string opaco base64url-encoded {ts: ISO, id: number}.
 * Cliente solo lo guarda y lo devuelve en `?cursor=...`. Si se cambia el
 * orden, hay que regenerar.
 *
 * Uso tipico:
 *
 *   const { items, nextCursor } = await paginate(pg, {
 *     baseQuery: 'SELECT id, created_at, ... FROM audit_events WHERE request_id = $1',
 *     baseParams: [requestId],
 *     orderColumn: 'created_at',
 *     idColumn: 'id',
 *     limit,
 *     cursor: req.query.cursor as string | undefined,
 *   });
 */
import type { Pool, QueryResult } from 'pg';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface PaginateOpts {
  baseQuery: string;       // SELECT ... FROM ... WHERE ... (sin ORDER BY/LIMIT)
  baseParams: unknown[];
  orderColumn: string;     // p.ej. 'created_at'
  idColumn: string;        // p.ej. 'id'
  limit: number;           // page size (cap a 200 para evitar abuso)
  cursor?: string;         // cursor opaco; si no, primera pagina
  /** Direccion: 'desc' (default, mas reciente primero) o 'asc' */
  direction?: 'desc' | 'asc';
}

interface DecodedCursor {
  ts: string;
  id: number;
}

export function encodeCursor(c: DecodedCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(c: string): DecodedCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (typeof obj?.ts !== 'string' || typeof obj?.id !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}

export async function paginate<T extends { id: number }>(
  pg: Pool,
  opts: PaginateOpts,
): Promise<CursorPage<T>> {
  const limit = Math.max(1, Math.min(opts.limit, 200));
  const dir = opts.direction ?? 'desc';
  const cmp = dir === 'desc' ? '<' : '>';
  const order = dir === 'desc' ? 'DESC' : 'ASC';

  const params: unknown[] = [...opts.baseParams];
  let query = opts.baseQuery;

  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      // (orderColumn, id) keyset comparison
      params.push(c.ts, c.id);
      const $a = `$${params.length - 1}`;
      const $b = `$${params.length}`;
      query += query.toUpperCase().includes(' WHERE ') ? ' AND ' : ' WHERE ';
      query += `(${opts.orderColumn}, ${opts.idColumn}) ${cmp} (${$a}::timestamptz, ${$b}::int)`;
    }
  }

  query += ` ORDER BY ${opts.orderColumn} ${order}, ${opts.idColumn} ${order} LIMIT ${limit + 1}`;

  const res: QueryResult<T> = await pg.query(query, params);
  const items = res.rows.slice(0, limit);
  const hasMore = res.rows.length > limit;
  const last = items[items.length - 1] as (T & { created_at?: string | Date }) | undefined;

  let nextCursor: string | null = null;
  if (hasMore && last) {
    // El caller debe asegurarse de incluir 'created_at' (o el orderColumn) en SELECT
    const ts =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (last as any)[opts.orderColumn] instanceof Date
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (last as any)[opts.orderColumn].toISOString()
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          String((last as any)[opts.orderColumn]);
    nextCursor = encodeCursor({ ts, id: last.id });
  }

  return { items, nextCursor };
}
