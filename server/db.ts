// Acesso ao PostgreSQL: pool de conexões e transação por requisição.
// Cada transação define sisti.usuario_id, usado pelo RLS e pelos eventos.
import pg from 'pg';
import { config } from './config';

// Conversões de tipo: datas como texto 'AAAA-MM-DD', numéricos como number
pg.types.setTypeParser(1082, (v: string) => v);          // date
pg.types.setTypeParser(1700, (v: string) => parseFloat(v)); // numeric
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10)); // bigint (contagens)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolMax });

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

/** Executa `fn` em uma transação com o usuário da sessão definido. */
export async function tx<T>(usuarioId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const db: Db = {
    async query(sql, params = []) { return (await client.query(sql, params)).rows; },
    async one(sql, params = []) { return (await client.query(sql, params)).rows[0]; },
  };
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('search_path', 'sisti, public', true)");
    if (usuarioId) await client.query("SELECT set_config('sisti.usuario_id', $1, true)", [usuarioId]);
    const r = await fn(db);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
