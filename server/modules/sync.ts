// Sincronização offline: recebe a fila (outbox) do aparelho, aplica em ordem e registra conflitos.
import { z } from 'zod';
import { tx } from '../db';
import { exigir } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { abrirChamado, abrirChamadoSchema } from './chamados';
import { movimentar, movimentoSchema } from './equipamentos';

const operacao = z.object({
  id: z.string().uuid(),
  tipo: z.enum(['ABRIR_CHAMADO', 'MOVIMENTAR']),
  payload: z.record(z.any()),
  ocorrido_em: z.string().datetime({ offset: true }),
});

export function rotasSync(r: Router) {
  r.post('/api/sync', async ({ usuario, body }) => {
    const u = exigir(usuario);
    const { operacoes } = validar(z.object({ operacoes: z.array(operacao).max(200) }), body);
    const resultados: { id: string; ok: boolean; erro?: string; resultado?: unknown }[] = [];
    // Cada operação em sua própria transação: uma falha não bloqueia as demais
    for (const op of operacoes) {
      try {
        const resultado = await tx(u.id, async db => {
          if (await db.one('SELECT 1 FROM sync_conflito WHERE id = $1', [op.id])) {
            throw new HttpError(409, 'Operação já registrada como conflito');
          }
          if (op.tipo === 'ABRIR_CHAMADO') {
            return abrirChamado(db, u, validar(abrirChamadoSchema, { ...op.payload, id: op.id, aberto_em: op.ocorrido_em }));
          }
          const m = validar(movimentoSchema.extend({ equipamento_id: z.string().uuid() }), { ...op.payload, id: op.id, ocorrido_em: op.ocorrido_em });
          return movimentar(db, u, m.equipamento_id, m);
        });
        resultados.push({ id: op.id, ok: true, resultado });
      } catch (e: any) {
        const erro = e?.message || 'Erro desconhecido';
        // Conflito: a operação deixou de ser válida no servidor; fica para o técnico resolver
        await tx(u.id, db => db.query(
          `INSERT INTO sync_conflito (id, usuario_id, tipo, payload, erro, ocorrido_em) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [op.id, u.id, op.tipo, op.payload, erro, op.ocorrido_em])).catch(() => {});
        resultados.push({ id: op.id, ok: false, erro });
      }
    }
    return { resultados };
  });

  r.get('/api/sync/conflitos', async ({ usuario }) => {
    const u = exigir(usuario);
    return tx(u.id, db => db.query(
      `SELECT sc.*, us.nome AS usuario FROM sync_conflito sc JOIN usuario us ON us.id = sc.usuario_id
        WHERE sc.resolvido_em IS NULL AND ($1 OR sc.usuario_id = $2) ORDER BY sc.registrado_em`,
      [u.rede_toda || u.perfil === 'TECNICO', u.id]));
  });

  r.post('/api/sync/conflitos/:id/resolver', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'chamado.tratar');
    const { resolucao } = validar(z.object({ resolucao: z.string().min(3) }), body);
    return tx(u.id, async db => {
      const r2 = await db.query(`UPDATE sync_conflito SET resolvido_em = now(), resolvido_por = $2, resolucao = $3
                                  WHERE id = $1 AND resolvido_em IS NULL RETURNING id`, [params.id, u.id, resolucao]);
      if (!r2.length) throw new HttpError(404, 'Conflito não encontrado');
      return { ok: true };
    });
  });
}
