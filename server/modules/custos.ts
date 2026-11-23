// Custos reais: lançamento (somente inclusão), estorno e fechamento mensal.
import { z } from 'zod';
import { tx } from '../db';
import { exigir } from '../auth';
import { enviarCsv, HttpError, validar, type Router } from '../http';

const uuid = z.string().uuid();
const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform(v => (v === '' ? null : v ?? null));
const competencia = z.string().regex(/^\d{4}-\d{2}(-01)?$/, 'Use AAAA-MM').transform(s => s.slice(0, 7) + '-01');

export function rotasCustos(r: Router) {
  r.get('/api/custos', async (ctx) => {
    const u = exigir(ctx.usuario);
    const q = ctx.query;
    const f: string[] = []; const p: unknown[] = [];
    const add = (cond: string, v: unknown) => { p.push(v); f.push(cond.replace('?', '$' + p.length)); };
    if (q.get('competencia')) add('c.competencia = ?::date', q.get('competencia')!.slice(0, 7) + '-01');
    if (q.get('loja')) add('c.loja_id = ?', q.get('loja'));
    if (q.get('equipamento')) add('c.equipamento_id = ?', q.get('equipamento'));
    if (q.get('chamado')) add('c.chamado_id = ?', q.get('chamado'));
    const linhas = await tx(u.id, db => db.query(
      `SELECT c.*, e.descricao AS equipamento, e.numero_serie, l.codigo AS loja_codigo, d.nome AS departamento,
              f.razao_social AS fornecedor, ch.numero AS chamado_numero, us.nome AS usuario,
              EXISTS (SELECT 1 FROM custo_lancamento x WHERE x.estorno_de = c.id) AS estornado,
              EXISTS (SELECT 1 FROM fechamento_mensal fm WHERE fm.competencia = c.competencia) AS fechado
         FROM custo_lancamento c JOIN equipamento e ON e.id = c.equipamento_id JOIN loja l ON l.id = c.loja_id
         JOIN departamento d ON d.id = c.departamento_id LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
         LEFT JOIN chamado ch ON ch.id = c.chamado_id JOIN usuario us ON us.id = c.usuario_id
        ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY c.registrado_em DESC LIMIT 2000`, p));
    if (q.get('format') === 'csv') {
      enviarCsv(ctx.res, 'custos', linhas.map((c: any) => ({ competencia: c.competencia, loja: c.loja_codigo, departamento: c.departamento,
        equipamento: c.equipamento, serie: c.numero_serie, chamado: c.chamado_numero, fornecedor: c.fornecedor, tipo: c.tipo,
        valor: String(c.valor).replace('.', ','), nfe: c.nfe_chave, estorno_de: c.estorno_de })));
      return undefined;
    }
    return linhas;
  });

  r.post('/api/custos', async ({ usuario, body }) => {
    const u = exigir(usuario, 'custo.lancar');
    const d = validar(z.object({
      equipamento_id: uuid, chamado_id: opcional(uuid), orcamento_id: opcional(uuid), fornecedor_id: opcional(uuid),
      tipo: z.enum(['PECA', 'MAO_DE_OBRA', 'FRETE', 'DESLOCAMENTO', 'OUTROS']),
      valor: z.coerce.number().positive('Valor deve ser positivo'),
      competencia: competencia.optional(),
      nfe_chave: opcional(z.string().regex(/^\d{44}$/, 'Chave de NF-e tem 44 dígitos')),
    }), body);
    return tx(u.id, async db => {
      // loja e departamento da data do lançamento
      const e = await db.one('SELECT loja_id, departamento_id FROM equipamento WHERE id = $1', [d.equipamento_id]);
      if (!e) throw new HttpError(404, 'Equipamento não encontrado');
      let orcamentoId = d.orcamento_id;
      if (d.chamado_id && !orcamentoId) {
        orcamentoId = (await db.one(`SELECT id FROM orcamento WHERE chamado_id = $1 AND status = 'APROVADO'`, [d.chamado_id]))?.id ?? null;
      }
      const row = await db.one(
        `INSERT INTO custo_lancamento (equipamento_id, loja_id, departamento_id, chamado_id, orcamento_id, fornecedor_id, tipo, valor, competencia, nfe_chave, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9::date, date_trunc('month', now())::date), $10, $11) RETURNING id`,
        [d.equipamento_id, e.loja_id, e.departamento_id, d.chamado_id, orcamentoId, d.fornecedor_id, d.tipo, d.valor, d.competencia ?? null, d.nfe_chave, u.id]);
      // Desvio realizado x orçado (aviso; a justificativa é registrada no fechamento)
      let aviso: string | null = null;
      if (orcamentoId) {
        const dv = await db.one(`SELECT o.valor_total, (SELECT sum(valor) FROM custo_lancamento WHERE orcamento_id = o.id) AS realizado,
                                        (SELECT valor FROM parametro WHERE chave = 'alerta_desvio_orcado_pct') AS pct
                                   FROM orcamento o WHERE o.id = $1`, [orcamentoId]);
        if (dv && dv.realizado > dv.valor_total * (1 + dv.pct / 100)) {
          aviso = `Realizado (R$ ${dv.realizado.toFixed(2)}) supera o orçado (R$ ${dv.valor_total.toFixed(2)}) em mais de ${dv.pct}%`;
        }
      }
      const garantia = d.chamado_id ? await db.one('SELECT em_garantia FROM chamado WHERE id = $1', [d.chamado_id]) : null;
      if (garantia?.em_garantia) aviso = (aviso ? aviso + '. ' : '') + 'Chamado em garantia com custo lançado: verifique cobertura do fabricante';
      return { id: row.id, aviso };
    });
  });

  r.post('/api/custos/:id/estornar', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'custo.lancar');
    const { motivo } = validar(z.object({ motivo: z.string().min(5) }), body);
    return tx(u.id, async db => {
      const c = await db.one('SELECT * FROM custo_lancamento WHERE id = $1', [params.id]);
      if (!c) throw new HttpError(404, 'Lançamento não encontrado');
      if (c.estorno_de) throw new HttpError(422, 'Não se estorna um estorno');
      if (await db.one('SELECT 1 FROM custo_lancamento WHERE estorno_de = $1', [c.id])) throw new HttpError(422, 'Lançamento já estornado');
      // estorno entra na competência aberta corrente se a original estiver fechada
      const row = await db.one(
        `INSERT INTO custo_lancamento (equipamento_id, loja_id, departamento_id, chamado_id, orcamento_id, fornecedor_id, tipo, valor, competencia, nfe_chave, estorno_de, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 CASE WHEN EXISTS (SELECT 1 FROM fechamento_mensal WHERE competencia = $9) THEN date_trunc('month', now())::date ELSE $9 END,
                 $10,$11,$12) RETURNING id, competencia`,
        [c.equipamento_id, c.loja_id, c.departamento_id, c.chamado_id, c.orcamento_id, c.fornecedor_id, c.tipo, -c.valor, c.competencia, c.nfe_chave, c.id, u.id]);
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
                      VALUES ('ESTORNO_MOTIVO','custo',$1,$2,$3,$4,now())`, [row.id, c.equipamento_id, { motivo, estorno_de: c.id }, u.id]);
      return row;
    });
  });

  r.get('/api/fechamentos', async ({ usuario }) => {
    const u = exigir(usuario);
    return tx(u.id, db => db.query(
      `SELECT c.competencia, sum(c.valor) AS total, count(*) AS lancamentos, fm.fechado_em, us.nome AS fechado_por
         FROM custo_lancamento c LEFT JOIN fechamento_mensal fm ON fm.competencia = c.competencia
         LEFT JOIN usuario us ON us.id = fm.fechado_por
        GROUP BY c.competencia, fm.fechado_em, us.nome ORDER BY c.competencia DESC LIMIT 24`));
  });

  r.post('/api/fechamentos', async ({ usuario, body }) => {
    const u = exigir(usuario, 'custo.fechar');
    const d = validar(z.object({ competencia }), body);
    return tx(u.id, async db => {
      if (d.competencia >= new Date().toISOString().slice(0, 7) + '-01') throw new HttpError(422, 'Só é possível fechar competências passadas');
      await db.query('INSERT INTO fechamento_mensal (competencia, fechado_por) VALUES ($1, $2)', [d.competencia, u.id]);
      const resumo = await db.query(`SELECT l.codigo AS loja, sum(c.valor) AS total FROM custo_lancamento c JOIN loja l ON l.id = c.loja_id
                                      WHERE c.competencia = $1 GROUP BY l.codigo ORDER BY l.codigo`, [d.competencia]);
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, payload, usuario_id, ocorrido_em)
                      VALUES ('COMPETENCIA_FECHADA','fechamento',gen_random_uuid(),$1,$2,now())`, [{ competencia: d.competencia, resumo }, u.id]);
      return { ok: true, resumo };
    });
  });
}
