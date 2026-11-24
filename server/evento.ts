// Registro na linha do tempo / auditoria (tabela evento, só aceita inclusão).
// Movimentações, chamados e custos já geram eventos por gatilho no banco (db/04_app.sql);
// use esta função para as ações que o banco não registra sozinho (cadastros, usuários, agenda...).
import type { Db } from './db';

export interface NovoEvento {
  tipo: string;                    // ex.: 'CADASTRO_ALTERADO' (MAIÚSCULAS_COM_SUBLINHADO)
  entidade: string;                // tabela ou assunto: 'loja', 'usuario', 'agendamento'...
  entidadeId?: string | null;      // registro afetado; sem registro (ex.: fechamento), um id novo é gerado
  equipamentoId?: string | null;   // preencha quando o evento deve aparecer no histórico do equipamento
  payload: unknown;                // detalhes (gravado como JSON). Em alterações: { anterior, novo }
  usuarioId: string | null;        // quem fez (null = o próprio sistema)
}

export async function registrarEvento(db: Db, e: NovoEvento) {
  await db.query(
    `INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
     VALUES ($1, $2, coalesce($3::uuid, gen_random_uuid()), $4, $5, $6, now())`,
    [e.tipo, e.entidade, e.entidadeId ?? null, e.equipamentoId ?? null, e.payload, e.usuarioId]);
}
