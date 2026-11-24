// Painel executivo / por loja (seção 12): custos, manutenção, reincidência e tendências.
import { useState } from 'react';
import { getComCache } from '../api';
import { BarrasH, GraficoLinha, MapaCalor } from '../charts';
import { Carregando, Kpi, Link, Pill, PRIORIDADE, STATUS, Tabela, moeda, num, useApp, useCarregar } from '../ui';

export function Dashboard() {
  const { ref, usuario, navegar } = useApp();
  const [meses, setMeses] = useState(12);
  const [loja, setLoja] = useState('');
  const [aba, setAba] = useState<'rede' | 'manutencao' | 'reincidencia' | 'tendencias'>('rede');
  const r = useCarregar(() => getComCache(`/api/dashboard?meses=${meses}${loja ? '&loja=' + loja : ''}`), [meses, loja]);

  return (
    <>
      <div className="topo">
        <div>
          <div className="migalha">{loja ? 'Painel da loja' : usuario.rede_toda ? 'Painel da rede' : 'Painel das suas lojas'}</div>
          <h1>{loja ? ref.lojas.find((l: any) => l.id === loja)?.nome_fantasia : 'Visão geral'}</h1>
        </div>
        <div className="acoes">
          {ref.lojas.length > 1 && (
            <select aria-label="Loja" value={loja} onChange={e => setLoja(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Todas as lojas</option>
              {ref.lojas.filter((l: any) => l.tipo !== 'CD').map((l: any) => <option key={l.id} value={l.id}>{l.codigo} – {l.nome_fantasia}</option>)}
            </select>
          )}
          <select aria-label="Período" value={meses} onChange={e => setMeses(Number(e.target.value))} style={{ width: 'auto' }}>
            {[3, 6, 12, 24].map(m => <option key={m} value={m}>Últimos {m} meses</option>)}
          </select>
        </div>
      </div>
      <Carregando {...r}>{() => {
        const { dados: d, offline, em } = r.dados!;
        const c = d.cards;
        const variacao = c.custo_periodo_anterior ? ((c.custo_periodo - c.custo_periodo_anterior) / c.custo_periodo_anterior) * 100 : null;
        const meses_ = d.tendencia.map((t: any) => t.mes);
        return (
          <>
            {offline && <div className="aviso atencao">Dados guardados no aparelho em {new Date(em!).toLocaleString('pt-BR')}.</div>}
            <div className="grade g6" style={{ marginBottom: 16 }}>
              <Kpi rotulo={`Custo (${meses} meses)`} valor={moeda(c.custo_periodo, true)}
                   sub={variacao === null ? 'sem período anterior' : <span className={variacao > 0 ? 'var-pos' : 'var-neg'}>{variacao > 0 ? '▲' : '▼'} {num(Math.abs(variacao), 1)}% vs. período anterior</span>} />
              <Kpi rotulo="Em manutenção" valor={num(c.em_manutencao)} sub={`${num(c.aguardando_orcamento)} aguardando orçamento · ${num(100 * c.em_manutencao / (c.parque_ativo || 1), 1)}% do parque`} alerta={c.em_manutencao > 0 && c.em_manutencao / (c.parque_ativo || 1) > 0.05} />
              <Kpi rotulo="Em trânsito" valor={num(c.em_transito)} sub="entre loja, CD e fornecedor" />
              <Kpi rotulo="Chamados abertos" valor={num(c.chamados_abertos)} sub={`custo médio ${moeda(c.custo_medio_chamado, true)}`} />
              <Kpi rotulo="MTTR" valor={c.mttr_dias === null ? '—' : `${num(c.mttr_dias, 1)} dias`} sub={`${num(c.dias_aguardando_orcamento, 1)} dias até aprovar`} />
              <Kpi rotulo="Reincidência" valor={c.taxa_reincidencia === null ? '—' : `${num(c.taxa_reincidencia, 1)}%`} sub={`SLA cumprido ${c.sla_cumprido_pct === null ? '—' : num(c.sla_cumprido_pct, 0) + '%'}`} alerta={c.taxa_reincidencia > 15} />
            </div>

            <div className="abas">
              {([['rede', 'Custos e lojas'], ['manutencao', `Em manutenção (${d.emManutencao.length})`], ['reincidencia', 'Reincidência por modelo'], ['tendencias', 'Tendências']] as const)
                .map(([k, t]) => <button key={k} className={aba === k ? 'ativa' : ''} onClick={() => setAba(k)}>{t}</button>)}
            </div>

            {aba === 'rede' && (
              <div className="grade g3">
                <div className="card span2">
                  <div className="card-topo"><h2>Custo mensal e recorrência</h2><span className="muted small">média móvel de 3 meses</span></div>
                  <GraficoLinha meses={meses_} series={[
                    { nome: 'Custo', valores: d.tendencia.map((t: any) => Number(t.custo)), barras: true, cor: '#9cc3bb' },
                    { nome: 'Média móvel 3m', valores: d.tendencia.map((t: any) => t.custo_mm3), cor: '#155e5f' },
                  ]} />
                  <div style={{ marginTop: 12 }}>
                    <GraficoLinha altura={150} meses={meses_} formato={v => num(v)} series={[
                      { nome: 'Chamados corretivos', valores: d.tendencia.map((t: any) => Number(t.chamados)), cor: '#2c5d8f' },
                      { nome: 'Reincidentes', valores: d.tendencia.map((t: any) => Number(t.reincidentes)), cor: '#b4372f' },
                    ]} />
                  </div>
                </div>
                <div className="card">
                  <div className="card-topo"><h2>Alertas</h2><span className="muted small">{d.alertas.length}</span></div>
                  {d.alertas.length === 0 && <div className="muted">Nenhum alerta.</div>}
                  <div style={{ maxHeight: 470, overflowY: 'auto' }}>
                    {d.alertas.map((a: any, i: number) => (
                      <div className="alerta-item" key={i}>
                        <span className={`pill p-${a.nivel === 'alto' ? 'vermelho' : 'ambar'}`}>{a.tipo}</span>
                        <span>{a.link ? <Link para={a.link}>{a.texto}</Link> : a.texto}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card span2">
                  <div className="card-topo"><h2>Unidades com maiores custos</h2><span className="muted small">absoluto e normalizado</span></div>
                  <Tabela linhas={d.ranking} onClick={l => setLoja(l.id)} colunas={[
                    { t: 'Loja', c: l => <><strong>{l.codigo}</strong> <span className="muted">{l.nome_fantasia}</span></> },
                    { t: 'Custo', num: true, c: l => moeda(l.custo, true) },
                    { t: 'Var.', num: true, c: l => { if (!Number(l.custo_anterior)) return '—'; const v = (l.custo - l.custo_anterior) / l.custo_anterior * 100; return <span className={v > 0 ? 'var-pos' : 'var-neg'}>{v > 0 ? '+' : ''}{num(v, 0)}%</span>; } },
                    { t: 'Por m²', num: true, c: l => moeda(l.custo_m2), movel: false },
                    { t: 'Por checkout', num: true, c: l => moeda(l.custo_checkout, true), movel: false },
                    { t: 'Chamados', num: true, c: l => num(l.chamados), movel: false },
                    { t: 'Equip.', num: true, c: l => num(l.equipamentos), movel: false },
                  ]} />
                </div>
                <div className="card">
                  <h2>Custo por grupo</h2>
                  <BarrasH itens={d.porGrupo.map((g: any) => ({ rotulo: g.nome, valor: Number(g.custo) }))} />
                  <h2 style={{ marginTop: 20 }}>Custo por departamento</h2>
                  <BarrasH cor="#2c5d8f" itens={d.porDepartamento.map((g: any) => ({ rotulo: g.nome, valor: Number(g.custo) }))} />
                </div>
              </div>
            )}

            {aba === 'manutencao' && (
              <div className="card">
                <div className="card-topo"><h2>Produtos em manutenção</h2><span className="muted small">vermelho = acima do SLA do fornecedor</span></div>
                <Tabela linhas={d.emManutencao} onClick={l => navegar('/equipamentos/' + l.id)} vazio="Nenhum equipamento em manutenção" colunas={[
                  { t: 'Equipamento', c: l => <><strong>{l.descricao}</strong><div className="muted small mono">{l.numero_serie}</div></> },
                  { t: 'Modelo', c: l => <span className="mono">{l.modelo}</span>, movel: false },
                  { t: 'Loja', c: l => <>{l.loja_codigo}{l.critica && !l.tem_reserva && <span className="pill p-vermelho" style={{ marginLeft: 6 }}>sem reserva</span>}</> },
                  { t: 'Status', c: l => <Pill mapa={STATUS} valor={l.status} /> },
                  { t: 'Prioridade', c: l => l.prioridade ? <Pill mapa={PRIORIDADE} valor={l.prioridade} /> : '—', movel: false },
                  { t: 'Fornecedor', c: l => l.fornecedor || '—', movel: false },
                  { t: 'Dias parado', num: true, c: l => <strong style={{ color: l.sla_dias && l.dias_parado > l.sla_dias ? 'var(--vermelho)' : undefined }}>{num(l.dias_parado)}</strong> },
                  { t: 'SLA', num: true, c: l => l.sla_dias ? `${l.sla_dias} d` : '—', movel: false },
                ]} />
              </div>
            )}

            {aba === 'reincidencia' && (
              <div className="grade g2">
                <div className="card">
                  <div className="card-topo"><h2>Modelos com maior taxa de falha</h2><span className="muted small">falhas por equipamento instalado</span></div>
                  <Tabela linhas={d.modelos} colunas={[
                    { t: 'Modelo', c: l => <><span className="mono">{l.modelo}</span> {l.sinalizado && <span className="pill p-vermelho">lote/fabricante</span>}<div className="muted small">{l.marca} · {l.descricao}</div></> },
                    { t: 'Instalados', num: true, c: l => num(l.instalados) },
                    { t: 'Falhas', num: true, c: l => num(l.falhas) },
                    { t: 'Por equip.', num: true, c: l => <strong>{num(l.falhas_por_equipamento, 2)}</strong> },
                    { t: '% com falha', num: true, c: l => `${num(l.pct_equip_com_falha, 0)}%` },
                    { t: 'Reincid.', num: true, c: l => num(l.reincidentes) },
                  ]} />
                </div>
                <div className="card">
                  <div className="card-topo"><h2>Modelo × categoria de falha</h2><span className="muted small">quantidade de chamados</span></div>
                  <MapaCalor celulas={d.mapaCalor} />
                </div>
              </div>
            )}

            {aba === 'tendencias' && (
              <div className="grade g2">
                <div className="card span2">
                  <div className="card-topo"><h2>Custo mensal com projeção</h2><span className="muted small">regressão linear dos últimos 6 meses fechados</span></div>
                  <GraficoLinha meses={[...meses_, ...proximosMeses(meses_[meses_.length - 1], Math.max(0, d.projecao.length - 1))]} series={serieProjecao(d.tendencia, d.projecao)} />
                  <p className="muted small">A projeção parte do último mês fechado; o mês corrente aparece parcial. É uma tendência simples, não uma previsão orçamentária.</p>
                </div>
                <div className="card">
                  <h2>Custo acumulado próximo do valor de compra</h2>
                  <Tabela linhas={d.proximosDoValor} onClick={l => navegar('/equipamentos/' + l.id)} vazio="Nenhum equipamento acima de 30%" colunas={[
                    { t: 'Equipamento', c: l => <>{l.descricao}<div className="muted small">{l.loja_codigo} · {l.numero_serie}</div></> },
                    { t: 'Compra', num: true, c: l => moeda(l.valor_aquisicao, true) },
                    { t: 'Acumulado', num: true, c: l => moeda(l.custo_acumulado, true) },
                    { t: '%', num: true, c: l => <div style={{ minWidth: 80 }}><div className={'barra' + (l.pct_aquisicao >= 50 ? ' alerta' : '')}><span style={{ width: Math.min(100, l.pct_aquisicao) + '%' }} /></div><span className="small">{num(l.pct_aquisicao, 0)}%</span></div> },
                  ]} />
                </div>
                <div className="card">
                  <h2>Sazonalidade de falhas</h2>
                  <BarrasH cor="#2c5d8f" formato={v => num(v)} itens={sazonalidade(d.tendencia)} />
                  <p className="muted small">Chamados corretivos por mês do ano no período selecionado.</p>
                </div>
              </div>
            )}
          </>
        );
      }}</Carregando>
    </>
  );
}

// A projeção começa no mês corrente (parcial), ancorada no último mês fechado
function serieProjecao(t: any[], proj: number[]) {
  const n = t.length, total = n + Math.max(0, proj.length - 1);
  const real = Array.from({ length: total }, (_, i) => (i < n ? Number(t[i].custo) : null));
  const projecao = Array.from({ length: total }, (_, i) => (i === n - 2 ? Number(t[i].custo) : i >= n - 1 ? proj[i - (n - 1)] ?? null : null));
  return [{ nome: 'Custo realizado', valores: real, cor: '#155e5f' }, { nome: 'Projeção', valores: projecao, cor: '#c98a1b', tracejada: true }];
}
function proximosMeses(ultimo: string, n: number) {
  const [a, m] = ultimo.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(a, m - 1 + i + 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
}
function sazonalidade(t: any[]) {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const soma = new Array(12).fill(0);
  t.forEach(x => { soma[Number(x.mes.slice(5)) - 1] += Number(x.chamados); });
  return nomes.map((n, i) => ({ rotulo: n, valor: soma[i] }));
}
