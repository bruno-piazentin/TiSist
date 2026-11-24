// Orçamentos: registro com itens, versões, cotações mínimas e aprovação por alçada.
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tx, type Db } from '../db';
import { exigir, pode } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { movimentar } from './equipamentos';
import { opcional, uuid } from '../validacao';


const itemSchema = z.object({
  tipo: z.enum(['PECA', 'MAO_DE_OBRA', 'FRETE', 'DESLOCAMENTO', 'OUTROS']),
  servico_id: opcional(uuid),
  descricao: z.string().min(2),
  quantidade: z.coerce.number().positive(),
  valor_unitario: z.coerce.number().min(0),
});
const orcamentoSchema = z.object({
  chamado_id: uuid,
  fornecedor_id: uuid,
  itens: z.array(itemSchema).min(1, 'Informe ao menos um item'),
  validade: opcional(z.string().date()),
  condicoes_pagamento: opcional(z.string()),
  fornecedor_unico_justificativa: opcional(z.string()),
});

const SELECT_ORC = `
  SELECT o.*, f.razao_social AS fornecedor, f.homologado, c.numero AS chamado_numero, c.relato, c.em_garantia,
         e.descricao AS equipamento, e.numero_serie, e.valor_aquisicao, p.modelo, l.codigo AS loja_codigo, l.nome_fantasia AS loja,
         s.nome AS solicitante, a.nome AS aprovador, vc.custo_acumulado, vc.pct_aquisicao,
         (SELECT count(DISTINCT o2.fornecedor_id) FROM orcamento o2 WHERE o2.chamado_id = o.chamado_id
             AND o2.status IN ('RECEBIDO','EM_ANALISE','APROVADO','REPROVADO')) AS cotacoes
    FROM orcamento o JOIN fornecedor f ON f.id = o.fornecedor_id JOIN chamado c ON c.id = o.chamado_id
    JOIN equipamento e ON e.id = o.equipamento_id JOIN produto p ON p.id = e.produto_id JOIN loja l ON l.id = o.loja_id
    JOIN usuario s ON s.id = o.solicitante_id LEFT JOIN usuario a ON a.id = o.aprovador_id
    LEFT JOIN vw_custo_equipamento vc ON vc.id = o.equipamento_id`;

/** Grava orçamento (nova versão quando `anterior` informado). */
async function gravar(db: Db, usuarioId: string, d: z.infer<typeof orcamentoSchema>, anterior?: any) {
  const c = await db.one(`SELECT id, equipamento_id, loja_id, situacao FROM chamado WHERE id = $1`, [d.chamado_id]);
  if (!c) throw new HttpError(404, 'Chamado não encontrado');
  if (['ENCERRADO', 'CANCELADO'].includes(c.situacao)) throw new HttpError(422, 'Chamado encerrado não recebe orçamento');
  const f = await db.one('SELECT homologado FROM fornecedor WHERE id = $1', [d.fornecedor_id]);
  if (!f?.homologado) throw new HttpError(422, 'Somente fornecedores homologados podem orçar');
  const soma = (t: string[]) => d.itens.filter(i => t.includes(i.tipo)).reduce((s, i) => s + Math.round(i.quantidade * i.valor_unitario * 100) / 100, 0);
  const o = await db.one(
    `INSERT INTO orcamento (numero, versao, chamado_id, equipamento_id, fornecedor_id, loja_id, solicitante_id,
                            valor_pecas, valor_mao_obra, valor_frete, valor_deslocamento, validade, condicoes_pagamento,
                            status, fornecedor_unico_justificativa)
     VALUES (coalesce($1, nextval('seq_orcamento')), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'RECEBIDO', $14)
     RETURNING id, numero, versao, valor_total`,
    [anterior?.numero ?? null, anterior ? anterior.versao + 1 : 1, c.id, c.equipamento_id, d.fornecedor_id, c.loja_id, usuarioId,
     soma(['PECA', 'OUTROS']), soma(['MAO_DE_OBRA']), soma(['FRETE']), soma(['DESLOCAMENTO']),
     d.validade, d.condicoes_pagamento, d.fornecedor_unico_justificativa]);
  for (const i of d.itens) {
    await db.query(`INSERT INTO orcamento_item (orcamento_id, tipo, servico_id, descricao, quantidade, valor_unitario) VALUES ($1,$2,$3,$4,$5,$6)`,
                   [o.id, i.tipo, i.servico_id, i.descricao, i.quantidade, i.valor_unitario]);
  }
  await db.query(`UPDATE chamado SET situacao = CASE WHEN situacao = 'ABERTO' THEN 'EM_ORCAMENTO' ELSE situacao END,
                    orcamento_em = coalesce(orcamento_em, now()), fornecedor_id = coalesce(fornecedor_id, $2) WHERE id = $1`, [c.id, d.fornecedor_id]);
  return o;
}

export function rotasOrcamentos(r: Router) {
  r.get('/api/orcamentos', async ({ usuario, query }) => {
    const u = exigir(usuario);
    const status = query.get('status') || 'pendentes';
    const cond = status === 'pendentes' ? `o.status IN ('RECEBIDO','EM_ANALISE')` : status === 'todos' ? 'true' : 'o.status = $1::status_orcamento';
    const linhas = await tx(u.id, db => db.query(`${SELECT_ORC} WHERE ${cond} ORDER BY o.numero DESC, o.versao DESC LIMIT 300`,
                                                  status === 'pendentes' || status === 'todos' ? [] : [status]));
    // Indica se o usuário pode aprovar (alçada e segregação)
    return linhas.map((o: any) => ({
      ...o,
      posso_aprovar: pode(u, 'orcamento.aprovar') && o.solicitante_id !== u.id && Number(o.valor_total) <= Number(u.alcada_max)
                     && ['RECEBIDO', 'EM_ANALISE'].includes(o.status),
    }));
  });

  r.get('/api/orcamentos/:id', async ({ usuario, params }) => {
    const u = exigir(usuario);
    return tx(u.id, async db => {
      const o = await db.one(`${SELECT_ORC} WHERE o.id = $1`, [params.id]);
      if (!o) throw new HttpError(404, 'Orçamento não encontrado');
      const itens = await db.query('SELECT * FROM orcamento_item WHERE orcamento_id = $1 ORDER BY tipo, descricao', [params.id]);
      // Quadro comparativo: outras cotações do mesmo chamado
      const cotacoes = await db.query(`SELECT o.id, o.numero, o.versao, o.status, o.valor_total, o.validade, f.razao_social AS fornecedor,
                                              f.sla_reparo_dias, f.garantia_servico_dias
                                         FROM orcamento o JOIN fornecedor f ON f.id = o.fornecedor_id
                                        WHERE o.chamado_id = $1 AND o.status <> 'SUBSTITUIDO' ORDER BY o.valor_total`, [o.chamado_id]);
      return { ...o, itens, cotacoes, posso_aprovar: pode(u, 'orcamento.aprovar') && o.solicitante_id !== u.id && Number(o.valor_total) <= Number(u.alcada_max) && ['RECEBIDO', 'EM_ANALISE'].includes(o.status) };
    });
  });

  r.post('/api/orcamentos', async ({ usuario, body }) => {
    const u = exigir(usuario, 'orcamento.registrar');
    const d = validar(orcamentoSchema, body);
    return tx(u.id, db => gravar(db, u.id, d));
  });

  // Alteração de orçamento = nova versão (a anterior fica SUBSTITUIDO, preservada)
  r.post('/api/orcamentos/:id/nova-versao', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'orcamento.registrar');
    return tx(u.id, async db => {
      const ant = await db.one('SELECT * FROM orcamento WHERE id = $1 FOR UPDATE', [params.id]);
      if (!ant) throw new HttpError(404, 'Orçamento não encontrado');
      if (!['RECEBIDO', 'EM_ANALISE', 'APROVADO'].includes(ant.status)) throw new HttpError(422, 'Somente orçamento vigente gera nova versão');
      if (ant.status === 'APROVADO') {
        const custo = await db.one('SELECT 1 FROM custo_lancamento WHERE orcamento_id = $1 LIMIT 1', [ant.id]);
        if (custo) throw new HttpError(422, 'Orçamento com custo lançado não pode ser substituído');
      }
      const d = validar(orcamentoSchema, { ...body, chamado_id: ant.chamado_id, fornecedor_id: ant.fornecedor_id });
      await db.query(`UPDATE orcamento SET status = 'SUBSTITUIDO' WHERE id = $1`, [ant.id]);
      return gravar(db, u.id, d, ant);
    });
  });

  r.post('/api/orcamentos/:id/decidir', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'orcamento.aprovar');
    const d = validar(z.object({ aprovar: z.boolean(), justificativa: z.string().min(3, 'Justificativa obrigatória') }), body);
    return tx(u.id, async db => {
      const o = await db.one(`${SELECT_ORC} WHERE o.id = $1`, [params.id]);
      if (!o) throw new HttpError(404, 'Orçamento não encontrado');
      if (!['RECEBIDO', 'EM_ANALISE'].includes(o.status)) throw new HttpError(422, 'Orçamento não está pendente');
      if (o.solicitante_id === u.id) throw new HttpError(422, 'Quem registrou o orçamento não pode aprová-lo (segregação de funções)');
      if (d.aprovar) {
        if (Number(o.valor_total) > Number(u.alcada_max)) {
          throw new HttpError(422, `Valor acima da sua alçada (R$ ${Number(u.alcada_max).toLocaleString('pt-BR')}). Encaminhe ao nível superior.`);
        }
        // Cotações mínimas acima do valor relevante (ou justificativa de fornecedor único)
        const par = Object.fromEntries((await db.query(`SELECT chave, valor FROM parametro WHERE chave IN ('valor_relevante_cotacao','cotacoes_minimas')`))
                                       .map((p: any) => [p.chave, Number(p.valor)]));
        if (Number(o.valor_total) >= par.valor_relevante_cotacao && Number(o.cotacoes) < par.cotacoes_minimas && !o.fornecedor_unico_justificativa) {
          throw new HttpError(422, `Acima de R$ ${par.valor_relevante_cotacao.toLocaleString('pt-BR')} são exigidas ${par.cotacoes_minimas} cotações (há ${o.cotacoes}) ou justificativa de fornecedor único.`);
        }
      }
      await db.query(`UPDATE orcamento SET status = $2, aprovador_id = $3, justificativa_decisao = $4, decidido_em = now() WHERE id = $1`,
                     [o.id, d.aprovar ? 'APROVADO' : 'REPROVADO', u.id, d.justificativa]);
      if (d.aprovar) {
        // Demais cotações do chamado ficam reprovadas automaticamente
        await db.query(`UPDATE orcamento SET status = 'REPROVADO', aprovador_id = $2, decidido_em = now(),
                          justificativa_decisao = 'Outra cotação aprovada' WHERE chamado_id = $1 AND id <> $3 AND status IN ('RECEBIDO','EM_ANALISE')
                          AND solicitante_id <> $2`, [o.chamado_id, u.id, o.id]);
        await db.query(`UPDATE chamado SET aprovado_em = now(), fornecedor_id = $2, situacao = 'EM_REPARO' WHERE id = $1`, [o.chamado_id, o.fornecedor_id]);
        // Aguardando orçamento -> Em manutenção (o envio ao fornecedor é a próxima movimentação)
        const e = await db.one('SELECT status FROM equipamento WHERE id = $1', [o.equipamento_id]);
        if (e?.status === 'AGUARDANDO_ORCAMENTO') {
          await movimentar(db, { ...u, perfil: 'GESTOR_TI' }, o.equipamento_id, {
            id: randomUUID(), status_novo: 'EM_MANUTENCAO', motivo: `Orçamento ${o.numero} v${o.versao} aprovado`,
            orcamento_id: o.id, chamado_id: o.chamado_id, confirmou_receb: false, teste_ok: null,
            destino_tipo: null, loja_destino_id: null, fornecedor_destino_id: null, documento: null });
        }
      }
      return { ok: true };
    });
  });
}
