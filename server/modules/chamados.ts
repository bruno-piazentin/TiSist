// Chamados (ordens de manutenção): abertura com garantia/reincidência, tratamento e encerramento.
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tx, type Db } from '../db';
import { exigir, pode, type Usuario } from '../auth';
import { enviarCsv, HttpError, validar, type Router } from '../http';
import { movimentar } from './equipamentos';
import { opcional, uuid } from '../validacao';


export const abrirChamadoSchema = z.object({
  id: uuid,                                     // UUID gerado no aparelho
  equipamento_id: uuid,
  tipo: z.enum(['CORRETIVA', 'PREVENTIVA', 'INSTALACAO', 'TROCA']).default('CORRETIVA'),
  prioridade: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).default('MEDIA'),
  categoria_falha_relatada_id: opcional(uuid),
  relato: z.string().min(5, 'Descreva o problema'),
  resolvido_remoto: z.boolean().default(false), // diagnóstico remoto resolveu: equipamento segue Ativo
  aberto_em: z.string().datetime({ offset: true }).optional(),
  // Opcional: já envia o equipamento em trânsito (sai do local atual para o destinatário) na mesma operação
  transito: z.object({
    destino_tipo: z.enum(['LOJA', 'CD', 'FORNECEDOR']),
    loja_destino_id: opcional(uuid),
    fornecedor_destino_id: opcional(uuid),
    documento: z.string().trim().min(1, 'Informe a nota de remessa ou romaneio'),
    motivo: opcional(z.string()),
  }).nullish(),
});
export type AbrirChamado = z.infer<typeof abrirChamadoSchema>;

/** Abre chamado (idempotente pelo id). Usado pela tela e pela sincronização offline. */
export async function abrirChamado(db: Db, u: Usuario, d: AbrirChamado) {
  // Conferido aqui (e não só na rota) porque a sincronização offline também chama esta função
  if (!pode(u, 'chamado.abrir')) throw new HttpError(403, 'Seu perfil não permite abrir chamado');
  const existente = await db.one('SELECT id, numero FROM chamado WHERE id = $1', [d.id]);
  if (existente) return { ...existente, duplicado: true };
  const e = await db.one(`SELECT e.id, e.status, e.loja_id, l.critica, p.modelo, g.codigo AS grupo
                            FROM equipamento e JOIN loja l ON l.id = e.loja_id
                            JOIN produto p ON p.id = e.produto_id JOIN grupo_produto g ON g.id = e.grupo_id
                           WHERE e.id = $1`, [d.equipamento_id]);
  if (!e) throw new HttpError(404, 'Equipamento não encontrado ou sem acesso');
  if (['BAIXADO', 'DESCARTADO'].includes(e.status)) throw new HttpError(422, 'Não é possível abrir chamado para equipamento baixado ou descartado');
  if (d.tipo === 'CORRETIVA') {
    const aberto = await db.one(`SELECT numero FROM chamado WHERE equipamento_id = $1 AND tipo = 'CORRETIVA'
                                   AND situacao NOT IN ('ENCERRADO','CANCELADO')`, [e.id]);
    if (aberto) throw new HttpError(409, `Já existe chamado corretivo aberto para este equipamento (nº ${aberto.numero})`);
  }

  // Equipamento que para operação (PDV, balança, impressora de caixa) em loja crítica sem reserva: prioridade crítica
  let prioridade = d.prioridade;
  if (d.tipo === 'CORRETIVA' && e.critica && ['AUT', 'BAL', 'IMP'].includes(e.grupo)) {
    const reserva = await db.one(`SELECT 1 FROM equipamento WHERE status = 'EM_RESERVA' AND local_loja_id = $1
                                    AND produto_id = (SELECT produto_id FROM equipamento WHERE id = $2) LIMIT 1`, [e.loja_id, e.id]);
    if (!reserva) prioridade = 'CRITICA';
  }
  const aberto = d.aberto_em ?? new Date().toISOString();
  const ch = await db.one(
    `INSERT INTO chamado (id, tipo, prioridade, equipamento_id, loja_id, categoria_falha_relatada_id, relato, solicitante_id, aberto_em,
                          situacao, encerrado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10 THEN 'ENCERRADO' ELSE 'ABERTO' END, CASE WHEN $10 THEN $9::timestamptz END)
     RETURNING id, numero, em_garantia, reincidente, prioridade`,
    [d.id, d.tipo, prioridade, e.id, e.loja_id, d.categoria_falha_relatada_id, d.relato, u.id, aberto, d.resolvido_remoto]);

  // Reincidência calculada pela categoria relatada na abertura (a confirmada vem no encerramento)
  if (d.categoria_falha_relatada_id && !ch.reincidente) {
    const r = await db.one(
      `SELECT count(*) + 1 >= (SELECT valor FROM parametro WHERE chave = 'reincidencia_equip_qtd') AS reinc
         FROM chamado WHERE equipamento_id = $1 AND id <> $2 AND situacao <> 'CANCELADO'
          AND coalesce(categoria_falha_id, categoria_falha_relatada_id) = $3
          AND aberto_em >= $4::timestamptz - make_interval(days => (SELECT valor::int FROM parametro WHERE chave = 'reincidencia_equip_dias'))`,
      [e.id, ch.id, d.categoria_falha_relatada_id, aberto]);
    if (r.reinc) { await db.query('UPDATE chamado SET reincidente = true WHERE id = $1', [ch.id]); ch.reincidente = true; }
  }
  // Corretiva com equipamento ativo: Ativo -> Aguardando orçamento
  if (d.tipo === 'CORRETIVA' && !d.resolvido_remoto && e.status === 'ATIVO') {
    await movimentar(db, u, e.id, {
      id: randomUUID(), status_novo: 'AGUARDANDO_ORCAMENTO', motivo: `Chamado ${ch.numero}: ${d.relato.slice(0, 120)}`,
      chamado_id: ch.id, confirmou_receb: false, ocorrido_em: aberto,
      destino_tipo: null, loja_destino_id: null, fornecedor_destino_id: null, documento: null, orcamento_id: null, teste_ok: null,
    });
  }
  // Movimentação junto com a abertura: status atual -> Trânsito para o destinatário (a matriz de transições valida)
  if (d.transito) {
    if (d.resolvido_remoto) throw new HttpError(422, 'Chamado resolvido no diagnóstico remoto não envia o equipamento em trânsito');
    const t = d.transito;
    await movimentar(db, u, e.id, {
      id: randomUUID(), status_novo: 'TRANSITO', motivo: t.motivo || `Chamado ${ch.numero}: envio para diagnóstico`,
      chamado_id: ch.id, confirmou_receb: false, ocorrido_em: new Date(Date.parse(aberto) + 1000).toISOString(),
      destino_tipo: t.destino_tipo, loja_destino_id: t.destino_tipo === 'FORNECEDOR' ? null : t.loja_destino_id,
      fornecedor_destino_id: t.destino_tipo === 'FORNECEDOR' ? t.fornecedor_destino_id : null,
      documento: t.documento, orcamento_id: null, teste_ok: null,
    });
  }
  // Histórico recente para a tela alertar
  const historico = await db.query(
    `SELECT c.numero, c.aberto_em, c.situacao, cf.nome AS categoria FROM chamado c
       LEFT JOIN categoria_falha cf ON cf.id = coalesce(c.categoria_falha_id, c.categoria_falha_relatada_id)
      WHERE c.equipamento_id = $1 AND c.id <> $2 AND c.aberto_em >= now() - interval '180 days' ORDER BY c.aberto_em DESC LIMIT 5`, [e.id, ch.id]);
  const modelo = await db.one(`SELECT taxa_pct, sinalizar_lote FROM vw_reincidencia_modelo
                                WHERE produto_id = (SELECT produto_id FROM equipamento WHERE id = $1) AND categoria_falha_id = $2`,
                              [e.id, d.categoria_falha_relatada_id]);
  return { ...ch, historico_recente: historico, modelo_em_alerta: modelo?.sinalizar_lote ?? false,
           aviso_garantia: ch.em_garantia ? 'Equipamento em garantia: acione o fabricante antes de orçar com fornecedor local.' : null };
}

const SELECT_CHAMADO = `
  SELECT c.*, e.descricao AS equipamento, e.numero_serie, e.status AS status_equipamento, p.modelo,
         l.codigo AS loja_codigo, l.nome_fantasia AS loja, f.razao_social AS fornecedor,
         cr.nome AS categoria_relatada, cf.nome AS categoria_confirmada, us.nome AS solicitante, tc.nome AS tecnico,
         extract(day FROM now() - coalesce((SELECT max(ocorrido_em) FROM movimentacao mv WHERE mv.chamado_id = c.id), c.aberto_em))::int AS dias_sem_movimento
    FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id JOIN produto p ON p.id = e.produto_id
    JOIN loja l ON l.id = c.loja_id LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
    LEFT JOIN categoria_falha cr ON cr.id = c.categoria_falha_relatada_id LEFT JOIN categoria_falha cf ON cf.id = c.categoria_falha_id
    JOIN usuario us ON us.id = c.solicitante_id LEFT JOIN usuario tc ON tc.id = c.tecnico_id`;

export function rotasChamados(r: Router) {
  r.get('/api/chamados', async (ctx) => {
    const u = exigir(ctx.usuario);
    const q = ctx.query;
    const f: string[] = []; const p: unknown[] = [];
    const add = (cond: string, v: unknown) => { p.push(v); f.push(cond.replace('?', '$' + p.length)); };
    const sit = q.get('situacao') || 'abertos';
    if (sit === 'abertos') f.push(`c.situacao NOT IN ('ENCERRADO','CANCELADO')`);
    else if (sit !== 'todos') add('c.situacao = ?', sit);
    if (q.get('loja')) add('c.loja_id = ?', q.get('loja'));
    if (q.get('equipamento')) add('c.equipamento_id = ?', q.get('equipamento'));
    if (q.get('prioridade')) add('c.prioridade = ?::prioridade', q.get('prioridade'));
    if (q.get('q')) add(`(e.descricao ILIKE ? OR e.numero_serie ILIKE $${p.length + 1} OR c.relato ILIKE $${p.length + 1} OR c.numero::text = $${p.length + 2})`, `%${q.get('q')}%`);
    if (q.get('q')) p.push(q.get('q'));
    const linhas = await tx(u.id, db => db.query(
      `${SELECT_CHAMADO} ${f.length ? 'WHERE ' + f.join(' AND ') : ''}
       ORDER BY CASE c.prioridade WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END, c.aberto_em DESC LIMIT 500`, p));
    if (q.get('format') === 'csv') { enviarCsv(ctx.res, 'chamados', linhas); return undefined; }
    return linhas;
  });

  r.get('/api/chamados/:id', async ({ usuario, params }) => {
    const u = exigir(usuario);
    return tx(u.id, async db => {
      const c = await db.one(`${SELECT_CHAMADO} WHERE c.id = $1`, [params.id]);
      if (!c) throw new HttpError(404, 'Chamado não encontrado');
      const [orcamentos, movimentacoes, custos] = await Promise.all([
        db.query(`SELECT o.*, f.razao_social AS fornecedor, s.nome AS solicitante, a.nome AS aprovador
                    FROM orcamento o JOIN fornecedor f ON f.id = o.fornecedor_id JOIN usuario s ON s.id = o.solicitante_id
                    LEFT JOIN usuario a ON a.id = o.aprovador_id WHERE o.chamado_id = $1 ORDER BY o.numero, o.versao`, [params.id]),
        db.query(`SELECT m.*, us.nome AS usuario FROM movimentacao m JOIN usuario us ON us.id = m.usuario_id
                   WHERE m.chamado_id = $1 OR (m.equipamento_id = $2 AND m.ocorrido_em >= $3) ORDER BY m.ocorrido_em`,
                 [params.id, c.equipamento_id, c.aberto_em]),
        db.query('SELECT * FROM custo_lancamento WHERE chamado_id = $1 ORDER BY registrado_em', [params.id]),
      ]);
      return { ...c, orcamentos, movimentacoes, custos };
    });
  });

  r.post('/api/chamados', async ({ usuario, body }) => {
    const u = exigir(usuario, 'chamado.abrir');
    const d = validar(abrirChamadoSchema, body);
    return tx(u.id, db => abrirChamado(db, u, d));
  });

  r.put('/api/chamados/:id', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'chamado.tratar');
    const d = validar(z.object({
      diagnostico: opcional(z.string()), causa_raiz: opcional(z.string()), categoria_falha_id: opcional(uuid),
      fornecedor_id: opcional(uuid), tecnico_id: opcional(uuid), prioridade: z.enum(['BAIXA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
    }).partial(), body) as Record<string, unknown>;
    const cols = Object.keys(d);
    if (!cols.length) return { id: params.id };
    return tx(u.id, async db => {
      if (d.fornecedor_id) {
        const f = await db.one('SELECT homologado FROM fornecedor WHERE id = $1', [d.fornecedor_id]);
        if (!f?.homologado) throw new HttpError(422, 'Somente fornecedores homologados recebem ordens de serviço');
      }
      const r2 = await db.query(`UPDATE chamado SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}
                                  WHERE id = $1 AND situacao NOT IN ('ENCERRADO','CANCELADO') RETURNING id`, [params.id, ...cols.map(c => d[c])]);
      if (!r2.length) throw new HttpError(422, 'Chamado inexistente ou já encerrado');
      return { id: params.id };
    });
  });

  r.post('/api/chamados/:id/encerrar', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'chamado.tratar');
    const d = validar(z.object({ categoria_falha_id: uuid, causa_raiz: z.string().min(3), diagnostico: opcional(z.string()) }), body);
    return tx(u.id, async db => {
      const c = await db.one(`SELECT c.id, e.status FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id
                               WHERE c.id = $1 AND c.situacao NOT IN ('ENCERRADO','CANCELADO')`, [params.id]);
      if (!c) throw new HttpError(404, 'Chamado inexistente ou já encerrado');
      if (!['ATIVO', 'EM_RESERVA', 'EM_ESTOQUE'].includes(c.status)) {
        throw new HttpError(422, 'Encerre somente após o retorno do equipamento (status Ativo, com teste registrado)');
      }
      await db.query(`UPDATE chamado SET situacao = 'ENCERRADO', encerrado_em = now(), categoria_falha_id = $2, causa_raiz = $3,
                        diagnostico = coalesce($4, diagnostico) WHERE id = $1`, [params.id, d.categoria_falha_id, d.causa_raiz, d.diagnostico]);
      return { ok: true };
    });
  });

  r.post('/api/chamados/:id/cancelar', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'chamado.tratar');
    const d = validar(z.object({ motivo: z.string().min(5), teste_ok: z.literal(true, { errorMap: () => ({ message: 'Confirme que o equipamento foi testado e funciona' }) }) }), body);
    return tx(u.id, async db => {
      const c = await db.one(`SELECT c.id, c.equipamento_id, e.status FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id
                               WHERE c.id = $1 AND c.situacao NOT IN ('ENCERRADO','CANCELADO')`, [params.id]);
      if (!c) throw new HttpError(404, 'Chamado inexistente ou já encerrado');
      if (c.status === 'AGUARDANDO_ORCAMENTO') {
        await movimentar(db, u, c.equipamento_id, { id: randomUUID(), status_novo: 'ATIVO', motivo: `Chamado cancelado: ${d.motivo}`,
          chamado_id: c.id, teste_ok: true, confirmou_receb: false, destino_tipo: null, loja_destino_id: null,
          fornecedor_destino_id: null, documento: null, orcamento_id: null });
      } else if (c.status !== 'ATIVO') {
        throw new HttpError(422, 'Só é possível cancelar antes da aprovação do orçamento');
      }
      await db.query(`UPDATE chamado SET situacao = 'CANCELADO', encerrado_em = now(), causa_raiz = $2 WHERE id = $1`, [c.id, d.motivo]);
      return { ok: true };
    });
  });
}
