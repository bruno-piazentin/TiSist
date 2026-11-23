// Dashboard e KPIs (seções 11 e 12 da especificação). Tudo respeita o RLS por loja.
import { tx } from '../db';
import { exigir } from '../auth';
import type { Router } from '../http';

/** Regressão linear simples para projetar os próximos meses. */
function projetar(valores: number[], meses: number): number[] {
  const n = valores.length;
  if (n < 3) return [];
  const xm = (n - 1) / 2, ym = valores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  valores.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
  const b = den ? num / den : 0, a = ym - b * xm;
  return Array.from({ length: meses }, (_, i) => Math.max(0, Math.round((a + b * (n + i)) * 100) / 100));
}

export function rotasDashboard(r: Router) {
  r.get('/api/dashboard', async ({ usuario, query }) => {
    const u = exigir(usuario);
    const meses = Math.min(Math.max(Number(query.get('meses') || 12), 1), 36);
    const loja = query.get('loja') || null;
    return tx(u.id, async db => {
      // $1 = meses, $2 = loja (opcional)
      const P = [meses, loja];
      const ini = `date_trunc('month', now()) - make_interval(months => $1::int - 1)`;
      const iniAnt = `date_trunc('month', now()) - make_interval(months => 2 * $1::int - 1)`;
      const fLoja = (col: string) => `($2::uuid IS NULL OR ${col} = $2::uuid)`;
      // consultas sem período: loja vai em $1
      const L = [loja];
      const fL = (col: string) => `($1::uuid IS NULL OR ${col} = $1::uuid)`;

      const [cards] = await db.query(`
        SELECT
          (SELECT coalesce(sum(valor),0) FROM custo_lancamento WHERE competencia >= ${ini} AND ${fLoja('loja_id')}) AS custo_periodo,
          (SELECT coalesce(sum(valor),0) FROM custo_lancamento WHERE competencia >= ${iniAnt} AND competencia < ${ini} AND ${fLoja('loja_id')}) AS custo_periodo_anterior,
          (SELECT coalesce(sum(valor),0) FROM custo_lancamento WHERE competencia = date_trunc('month', now()) AND ${fLoja('loja_id')}) AS custo_mes,
          (SELECT count(*) FROM equipamento WHERE status IN ('AGUARDANDO_ORCAMENTO','EM_MANUTENCAO','TRANSITO') AND ${fLoja('loja_id')}) AS em_manutencao,
          (SELECT count(*) FROM equipamento WHERE status = 'TRANSITO' AND ${fLoja('loja_id')}) AS em_transito,
          (SELECT count(*) FROM equipamento WHERE status = 'AGUARDANDO_ORCAMENTO' AND ${fLoja('loja_id')}) AS aguardando_orcamento,
          (SELECT count(*) FROM equipamento WHERE status NOT IN ('BAIXADO','DESCARTADO','EM_ESTOQUE') AND ${fLoja('loja_id')}) AS parque_ativo,
          (SELECT count(*) FROM chamado WHERE situacao NOT IN ('ENCERRADO','CANCELADO') AND ${fLoja('loja_id')}) AS chamados_abertos,
          (SELECT round(avg(extract(epoch FROM retorno_loja_em - aberto_em) / 86400)::numeric, 1) FROM chamado
            WHERE situacao = 'ENCERRADO' AND retorno_loja_em IS NOT NULL AND aberto_em >= ${ini} AND ${fLoja('loja_id')}) AS mttr_dias,
          (SELECT round(avg(extract(epoch FROM aprovado_em - aberto_em) / 86400)::numeric, 1) FROM chamado
            WHERE aprovado_em IS NOT NULL AND aberto_em >= ${ini} AND ${fLoja('loja_id')}) AS dias_aguardando_orcamento,
          (SELECT round(100.0 * count(*) FILTER (WHERE reincidente) / nullif(count(*),0), 1) FROM chamado
            WHERE tipo = 'CORRETIVA' AND situacao <> 'CANCELADO' AND aberto_em >= ${ini} AND ${fLoja('loja_id')}) AS taxa_reincidencia,
          (SELECT round(sum(cl.valor) / nullif(count(DISTINCT cl.chamado_id),0), 2) FROM custo_lancamento cl
            WHERE cl.chamado_id IS NOT NULL AND cl.competencia >= ${ini} AND ${fLoja('cl.loja_id')}) AS custo_medio_chamado,
          (SELECT round(100.0 * count(*) FILTER (WHERE c.retorno_loja_em - c.aberto_em <= make_interval(days => coalesce(f.sla_reparo_dias, 999)))
                        / nullif(count(*),0), 1)
             FROM chamado c JOIN fornecedor f ON f.id = c.fornecedor_id
            WHERE c.situacao = 'ENCERRADO' AND c.retorno_loja_em IS NOT NULL AND c.aberto_em >= ${ini} AND ${fLoja('c.loja_id')}) AS sla_cumprido_pct,
          (SELECT round(avg(satisfacao_nota)::numeric, 1) FROM chamado WHERE satisfacao_nota IS NOT NULL AND aberto_em >= ${ini} AND ${fLoja('loja_id')}) AS satisfacao`, P);

      const ranking = await db.query(`
        SELECT l.id, l.codigo, l.nome_fantasia, l.area_m2, l.qtd_checkouts,
               coalesce(sum(c.valor) FILTER (WHERE c.competencia >= ${ini}), 0) AS custo,
               coalesce(sum(c.valor) FILTER (WHERE c.competencia >= ${iniAnt} AND c.competencia < ${ini}), 0) AS custo_anterior,
               round(coalesce(sum(c.valor) FILTER (WHERE c.competencia >= ${ini}), 0) / nullif(l.area_m2, 0), 2) AS custo_m2,
               round(coalesce(sum(c.valor) FILTER (WHERE c.competencia >= ${ini}), 0) / nullif(l.qtd_checkouts, 0), 2) AS custo_checkout,
               (SELECT count(*) FROM chamado ch WHERE ch.loja_id = l.id AND ch.aberto_em >= ${ini}) AS chamados,
               (SELECT count(*) FROM equipamento e WHERE e.loja_id = l.id AND e.status NOT IN ('BAIXADO','DESCARTADO','EM_ESTOQUE')) AS equipamentos
          FROM loja l LEFT JOIN custo_lancamento c ON c.loja_id = l.id
         WHERE l.tipo <> 'CD' AND ${fLoja('l.id')} AND EXISTS (SELECT 1 FROM equipamento e WHERE e.loja_id = l.id)
         GROUP BY l.id ORDER BY custo DESC`, P);

      const tendencia = await db.query(`
        WITH m AS (SELECT generate_series(${ini}, date_trunc('month', now()), interval '1 month')::date AS mes)
        SELECT to_char(m.mes, 'YYYY-MM') AS mes,
               coalesce((SELECT sum(valor) FROM custo_lancamento c WHERE c.competencia = m.mes AND ${fLoja('c.loja_id')}), 0) AS custo,
               (SELECT count(*) FROM chamado ch WHERE date_trunc('month', ch.aberto_em) = m.mes AND ch.tipo = 'CORRETIVA' AND ${fLoja('ch.loja_id')}) AS chamados,
               (SELECT count(*) FROM chamado ch WHERE date_trunc('month', ch.aberto_em) = m.mes AND ch.reincidente AND ${fLoja('ch.loja_id')}) AS reincidentes
          FROM m ORDER BY m.mes`, P);
      // média móvel de 3 meses
      tendencia.forEach((t: any, i: number) => {
        const jan = tendencia.slice(Math.max(0, i - 2), i + 1);
        t.custo_mm3 = Math.round(jan.reduce((s: number, x: any) => s + Number(x.custo), 0) / jan.length * 100) / 100;
        t.chamados_mm3 = Math.round(jan.reduce((s: number, x: any) => s + Number(x.chamados), 0) / jan.length * 10) / 10;
      });
      // projeção usa só meses completos
      const fechados = tendencia.slice(0, -1).map((t: any) => Number(t.custo));
      const projecao = projetar(fechados.slice(-6), 3);

      const porGrupo = await db.query(`
        SELECT g.nome, sum(c.valor) AS custo FROM custo_lancamento c JOIN equipamento e ON e.id = c.equipamento_id
          JOIN grupo_produto g ON g.id = e.grupo_id WHERE c.competencia >= ${ini} AND ${fLoja('c.loja_id')}
         GROUP BY g.nome ORDER BY custo DESC`, P);
      const porDepartamento = await db.query(`
        SELECT d.nome, sum(c.valor) AS custo FROM custo_lancamento c JOIN departamento d ON d.id = c.departamento_id
         WHERE c.competencia >= ${ini} AND ${fLoja('c.loja_id')} GROUP BY d.nome ORDER BY custo DESC`, P);

      // Reincidência por modelo: taxa de falha sobre a base instalada (não número absoluto)
      const modelos = await db.query(`
        WITH base AS (SELECT produto_id, count(*) AS instalados FROM equipamento
                       WHERE status NOT IN ('BAIXADO','DESCARTADO','EM_ESTOQUE') AND ${fLoja('loja_id')} GROUP BY produto_id),
             f AS (SELECT e.produto_id, count(*) AS falhas, count(DISTINCT c.equipamento_id) AS equip_com_falha,
                          count(*) FILTER (WHERE c.reincidente) AS reincidentes
                     FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id
                    WHERE c.tipo = 'CORRETIVA' AND c.situacao <> 'CANCELADO' AND c.aberto_em >= ${ini} AND ${fLoja('c.loja_id')}
                    GROUP BY e.produto_id)
        SELECT p.id, p.modelo, p.descricao, m.nome AS marca, b.instalados, coalesce(f.falhas,0) AS falhas,
               coalesce(f.reincidentes,0) AS reincidentes,
               round(coalesce(f.falhas,0)::numeric / b.instalados, 2) AS falhas_por_equipamento,
               round(100.0 * coalesce(f.equip_com_falha,0) / b.instalados, 1) AS pct_equip_com_falha,
               EXISTS (SELECT 1 FROM vw_reincidencia_modelo v WHERE v.produto_id = p.id AND v.sinalizar_lote) AS sinalizado
          FROM base b JOIN produto p ON p.id = b.produto_id JOIN marca m ON m.id = p.marca_id LEFT JOIN f ON f.produto_id = b.produto_id
         ORDER BY falhas_por_equipamento DESC, falhas DESC LIMIT 12`, P);
      const mapaCalor = await db.query(`
        SELECT p.modelo, cf.nome AS categoria, count(*) AS falhas
          FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id JOIN produto p ON p.id = e.produto_id
          JOIN categoria_falha cf ON cf.id = coalesce(c.categoria_falha_id, c.categoria_falha_relatada_id)
         WHERE c.tipo = 'CORRETIVA' AND c.aberto_em >= ${ini} AND ${fLoja('c.loja_id')}
         GROUP BY p.modelo, cf.nome`, P);

      const emManutencao = await db.query(`
        SELECT e.id, e.descricao, e.numero_serie, e.status, p.modelo, m.nome AS marca, l.codigo AS loja_codigo, l.critica,
               coalesce(fl.razao_social, f.razao_social) AS fornecedor, ch.numero AS chamado_numero, ch.prioridade, ch.id AS chamado_id,
               extract(day FROM now() - ch.aberto_em)::int AS dias_parado,
               extract(day FROM now() - coalesce((SELECT max(ocorrido_em) FROM movimentacao mv WHERE mv.equipamento_id = e.id), ch.aberto_em))::int AS dias_sem_movimento,
               coalesce(f.sla_reparo_dias, fl.sla_reparo_dias) AS sla_dias,
               EXISTS (SELECT 1 FROM equipamento r WHERE r.status = 'EM_RESERVA' AND r.produto_id = e.produto_id AND r.local_loja_id = e.loja_id) AS tem_reserva
          FROM equipamento e JOIN produto p ON p.id = e.produto_id JOIN marca m ON m.id = p.marca_id JOIN loja l ON l.id = e.loja_id
          LEFT JOIN chamado ch ON ch.equipamento_id = e.id AND ch.situacao NOT IN ('ENCERRADO','CANCELADO')
          LEFT JOIN fornecedor f ON f.id = ch.fornecedor_id LEFT JOIN fornecedor fl ON fl.id = e.local_fornecedor_id
         WHERE e.status IN ('AGUARDANDO_ORCAMENTO','EM_MANUTENCAO','TRANSITO') AND ${fL('e.loja_id')}
         ORDER BY dias_parado DESC NULLS LAST`, L);

      const proximosDoValor = await db.query(`
        SELECT v.id, v.descricao, v.numero_serie, v.valor_aquisicao, v.custo_acumulado, v.pct_aquisicao, l.codigo AS loja_codigo
          FROM vw_custo_equipamento v JOIN loja l ON l.id = v.loja_id
         WHERE v.pct_aquisicao >= 30 AND ${fL('v.loja_id')} ORDER BY v.pct_aquisicao DESC LIMIT 10`, L);

      // Alertas automáticos (calculados na consulta)
      const par = Object.fromEntries((await db.query('SELECT chave, valor FROM parametro')).map((p: any) => [p.chave, Number(p.valor)]));
      const alertas: { tipo: string; nivel: 'alto' | 'medio'; texto: string; link?: string }[] = [];
      for (const e of emManutencao as any[]) {
        if (e.dias_sem_movimento > par.alerta_parado_dias)
          alertas.push({ tipo: 'Chamado parado', nivel: 'alto', texto: `${e.descricao} (${e.loja_codigo}) sem movimentação há ${e.dias_sem_movimento} dias`, link: `/equipamentos/${e.id}` });
        if (e.critica && !e.tem_reserva && e.prioridade === 'CRITICA')
          alertas.push({ tipo: 'Parado sem reserva', nivel: 'alto', texto: `${e.descricao} parado em loja crítica (${e.loja_codigo}) sem reserva`, link: `/equipamentos/${e.id}` });
        if (e.sla_dias && e.dias_parado > e.sla_dias)
          alertas.push({ tipo: 'SLA estourado', nivel: 'medio', texto: `${e.descricao} (${e.loja_codigo}) há ${e.dias_parado} dias; SLA ${e.sla_dias} dias`, link: `/equipamentos/${e.id}` });
      }
      const semOrcamento = await db.query(`
        SELECT c.id, c.numero, e.descricao, l.codigo, extract(day FROM now() - c.aberto_em)::int AS dias
          FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id JOIN loja l ON l.id = c.loja_id
          LEFT JOIN fornecedor f ON f.id = c.fornecedor_id
         WHERE c.situacao IN ('ABERTO','EM_ORCAMENTO') AND NOT EXISTS (SELECT 1 FROM orcamento o WHERE o.chamado_id = c.id)
           AND now() - c.aberto_em > make_interval(days => coalesce(f.sla_orcamento_dias, 3)) AND ${fL('c.loja_id')}`, L);
      semOrcamento.forEach((c: any) => alertas.push({ tipo: 'Orçamento sem resposta', nivel: 'medio', texto: `Chamado ${c.numero} – ${c.descricao} (${c.codigo}) há ${c.dias} dias sem orçamento`, link: `/chamados/${c.id}` }));
      const garantias = await db.query(`
        SELECT e.id, e.descricao, l.codigo, e.garantia_fim FROM equipamento e JOIN loja l ON l.id = e.loja_id
         WHERE e.garantia_fim BETWEEN current_date AND current_date + 30 AND e.status NOT IN ('BAIXADO','DESCARTADO') AND ${fL('e.loja_id')}
         ORDER BY e.garantia_fim LIMIT 20`, L);
      if (garantias.length) alertas.push({ tipo: 'Garantia vencendo', nivel: 'medio', texto: `${garantias.length} equipamento(s) com garantia vencendo em 30 dias`, link: '/equipamentos?garantia=30' });
      (modelos as any[]).filter(m => m.sinalizado).forEach(m => alertas.push({ tipo: 'Reincidência de modelo', nivel: 'alto', texto: `Modelo ${m.modelo} acima do limite de falhas: analisar fabricante ou lote` }));
      (proximosDoValor as any[]).filter(p => p.pct_aquisicao >= par.alerta_custo_aquisicao_pct).forEach(p =>
        alertas.push({ tipo: 'Custo próximo do valor de compra', nivel: 'medio', texto: `${p.descricao} (${p.loja_codigo}) já custou ${p.pct_aquisicao}% do valor de compra`, link: `/equipamentos/${p.id}` }));
      const desvios = await db.query(`
        SELECT o.numero, o.valor_total, sum(c.valor) AS realizado FROM orcamento o JOIN custo_lancamento c ON c.orcamento_id = o.id
         WHERE o.status = 'APROVADO' AND c.competencia >= ${ini} AND ${fLoja('o.loja_id')}
         GROUP BY o.id HAVING sum(c.valor) > o.valor_total * (1 + $3::numeric / 100)`, [...P, par.alerta_desvio_orcado_pct]);
      desvios.forEach((d: any) => alertas.push({ tipo: 'Custo acima do orçado', nivel: 'medio', texto: `Orçamento ${d.numero}: realizado R$ ${Number(d.realizado).toFixed(2)} × orçado R$ ${Number(d.valor_total).toFixed(2)}` }));

      const pendencias = await db.one(`
        SELECT (SELECT count(*) FROM orcamento WHERE status IN ('RECEBIDO','EM_ANALISE') AND ${fL('loja_id')}) AS orcamentos_pendentes,
               (SELECT count(*) FROM solicitacao_baixa sb JOIN equipamento e ON e.id = sb.equipamento_id WHERE sb.situacao = 'PENDENTE') AS baixas_pendentes,
               (SELECT count(*) FROM sync_conflito WHERE resolvido_em IS NULL) AS conflitos_sync`, L);

      return { meses, cards, ranking, tendencia, projecao, porGrupo, porDepartamento, modelos, mapaCalor, emManutencao,
               proximosDoValor, garantias, alertas, pendencias };
    });
  });
}
