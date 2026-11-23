// Aprovações: orçamentos pendentes (alçada e segregação) e solicitações de baixa.
import { useState } from 'react';
import { api } from '../api';
import { Campo, Carregando, Link, Modal, Pill, STATUS, STATUS_ORC, TIPO_CUSTO, Tabela, data, moeda, num, useAcao, useApp, useCarregar } from '../ui';

export function Aprovacoes() {
  const { usuario, pode } = useApp();
  const orc = useCarregar(() => api('GET', '/api/orcamentos?status=pendentes'), []);
  const bx = useCarregar(() => api('GET', '/api/baixas'), []);
  const [decidir, setDecidir] = useState<string | null>(null);
  const [baixa, setBaixa] = useState<any>(null);
  return (
    <>
      <div className="topo"><div><div className="migalha">Operação</div><h1>Aprovações</h1></div>
        {pode('orcamento.aprovar') && <span className="muted">Sua alçada: <strong>{moeda(usuario.alcada_max)}</strong></span>}</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-topo"><h2>Orçamentos pendentes</h2><span className="muted small">o valor define quem aprova; quem registrou não aprova</span></div>
        <Carregando {...orc}>{() => <Tabela linhas={orc.dados} vazio="Nenhum orçamento pendente" colunas={[
          { t: 'Nº', c: o => <strong>{o.numero} v{o.versao}</strong> },
          { t: 'Chamado', c: o => <Link para={'/chamados/' + o.chamado_id}>nº {o.chamado_numero}</Link> },
          { t: 'Equipamento', c: o => <>{o.equipamento}<div className="muted small">{o.loja_codigo} · <span className="mono">{o.modelo}</span></div></> },
          { t: 'Fornecedor', c: o => o.fornecedor, movel: false },
          { t: 'Cotações', num: true, c: o => num(o.cotacoes), movel: false },
          { t: 'Total', num: true, c: o => <strong>{moeda(o.valor_total)}</strong> },
          { t: '', c: o => o.posso_aprovar ? <button className="btn pequeno primario" onClick={() => setDecidir(o.id)}>Analisar</button>
                         : <span className="muted small">{o.solicitante_id === usuario.id ? 'registrado por você' : Number(o.valor_total) > usuario.alcada_max ? 'acima da sua alçada' : 'sem permissão'}</span> },
        ]} />}</Carregando>
      </div>
      <div className="card">
        <div className="card-topo"><h2>Solicitações de baixa e descarte</h2></div>
        <Carregando {...bx}>{() => <Tabela linhas={bx.dados} vazio="Nenhuma solicitação pendente" colunas={[
          { t: 'Tipo', c: b => <span className={`pill p-${b.tipo === 'BAIXA' ? 'ambar' : 'cinza'}`}>{b.tipo === 'BAIXA' ? 'Baixa' : 'Descarte'}</span> },
          { t: 'Equipamento', c: b => <><Link para={'/equipamentos/' + b.equipamento_id}>{b.descricao}</Link><div className="muted small">{b.loja_codigo} · {b.numero_serie}</div></> },
          { t: 'Motivo', c: b => <span className="small">{b.motivo}</span> },
          { t: 'Custo acum.', num: true, c: b => moeda(b.custo_acumulado, true), movel: false },
          { t: 'Solicitante', c: b => <>{b.solicitante}<div className="muted small">{data(b.criado_em)}</div></>, movel: false },
          { t: '', c: b => pode('baixa.aprovar') && b.solicitante_id !== usuario.id ? <button className="btn pequeno primario" onClick={() => setBaixa(b)}>Decidir</button> : <span className="muted small">{b.solicitante_id === usuario.id ? 'solicitada por você' : '—'}</span> },
        ]} />}</Carregando>
      </div>
      {decidir && <DecidirOrcamento id={decidir} onFechar={() => setDecidir(null)} onOk={orc.recarregar} />}
      {baixa && <DecidirBaixa b={baixa} onFechar={() => setBaixa(null)} onOk={bx.recarregar} />}
    </>
  );
}

/** Tela de decisão com dados para "reparar ou trocar" e quadro comparativo de cotações. */
export function DecidirOrcamento({ id, onFechar, onOk }: { id: string; onFechar: () => void; onOk: () => void }) {
  const { avisar } = useApp();
  const r = useCarregar(() => api('GET', '/api/orcamentos/' + id), [id]);
  const [justificativa, setJustificativa] = useState('');
  const acao = useAcao();
  const decidir = async (aprovar: boolean) => {
    if (await acao.executar(() => api('POST', `/api/orcamentos/${id}/decidir`, { aprovar, justificativa }))) {
      avisar(aprovar ? 'Orçamento aprovado' : 'Orçamento reprovado'); onOk(); onFechar();
    }
  };
  return (
    <Modal largo titulo="Análise de orçamento" onFechar={onFechar} rodape={r.dados?.posso_aprovar ? <>
      <button className="btn" onClick={onFechar}>Fechar</button>
      <button className="btn perigo" disabled={acao.enviando || justificativa.length < 3} onClick={() => decidir(false)}>Reprovar</button>
      <button className="btn sucesso" disabled={acao.enviando || justificativa.length < 3} onClick={() => decidir(true)}>Aprovar</button></> : <button className="btn" onClick={onFechar}>Fechar</button>}>
      <Carregando {...r}>{() => {
        const o = r.dados;
        const pctOrc = o.valor_aquisicao ? ((Number(o.custo_acumulado || 0) + Number(o.valor_total)) / o.valor_aquisicao) * 100 : null;
        return (
          <>
            {acao.erro && <div className="aviso erro">{acao.erro}</div>}
            {o.em_garantia && <div className="aviso atencao">Equipamento em garantia: confirme se o fabricante foi acionado.</div>}
            {pctOrc !== null && pctOrc >= 50 && <div className="aviso erro">Com este orçamento, o custo acumulado chega a {num(pctOrc, 0)}% do valor de compra: avalie a substituição.</div>}
            <div className="grade g2">
              <div><dl className="dl">
                <dt>Orçamento</dt><dd>nº {o.numero} v{o.versao} <Pill mapa={STATUS_ORC} valor={o.status} /></dd><dt>Fornecedor</dt><dd>{o.fornecedor}</dd>
                <dt>Equipamento</dt><dd>{o.equipamento} ({o.loja_codigo})</dd><dt>Relato</dt><dd>{o.relato}</dd><dt>Validade</dt><dd>{data(o.validade)}</dd>
                <dt>Registrado por</dt><dd>{o.solicitante}</dd>{o.fornecedor_unico_justificativa && <><dt>Fornecedor único</dt><dd>{o.fornecedor_unico_justificativa}</dd></>}
              </dl></div>
              <div className="card plano" style={{ background: '#fafbf8' }}><h3>Reparar ou trocar</h3><dl className="dl">
                <dt>Valor de compra</dt><dd>{moeda(o.valor_aquisicao)}</dd><dt>Custo acumulado</dt><dd>{moeda(o.custo_acumulado)} ({num(o.pct_aquisicao || 0, 0)}%)</dd>
                <dt>Este orçamento</dt><dd><strong>{moeda(o.valor_total)}</strong></dd><dt>Após aprovação</dt><dd>{pctOrc === null ? '—' : `${num(pctOrc, 0)}% do valor de compra`}</dd>
              </dl></div>
            </div>
            <h3 style={{ marginTop: 16 }}>Itens</h3>
            <Tabela linhas={o.itens} colunas={[{ t: 'Tipo', c: i => TIPO_CUSTO[i.tipo] || i.tipo }, { t: 'Descrição', c: i => i.descricao }, { t: 'Qtd.', num: true, c: i => num(i.quantidade, 1) }, { t: 'Unitário', num: true, c: i => moeda(i.valor_unitario) }, { t: 'Total', num: true, c: i => moeda(i.valor_total) }]} />
            {o.cotacoes.length > 1 && <><h3 style={{ marginTop: 16 }}>Comparativo de cotações</h3>
              <Tabela linhas={o.cotacoes} colunas={[
                { t: 'Fornecedor', c: x => <>{x.fornecedor}{x.id === o.id && <span className="pill p-azul" style={{ marginLeft: 6 }}>em análise</span>}</> },
                { t: 'Total', num: true, c: x => moeda(x.valor_total) }, { t: 'SLA reparo', num: true, c: x => x.sla_reparo_dias ? `${x.sla_reparo_dias} d` : '—' },
                { t: 'Garantia serviço', num: true, c: x => `${x.garantia_servico_dias} d` }, { t: 'Status', c: x => <Pill mapa={STATUS_ORC} valor={x.status} /> },
              ]} /></>}
            {o.posso_aprovar && <div style={{ marginTop: 16 }}><Campo rotulo="Justificativa da decisão" obrigatorio><textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} /></Campo></div>}
          </>
        );
      }}</Carregando>
    </Modal>
  );
}

function DecidirBaixa({ b, onFechar, onOk }: any) {
  const { avisar } = useApp();
  const [justificativa, setJustificativa] = useState('');
  const acao = useAcao();
  const decidir = async (aprovar: boolean) => {
    if (await acao.executar(() => api('POST', `/api/baixas/${b.id}/decidir`, { aprovar, justificativa }))) { avisar(aprovar ? 'Baixa aprovada' : 'Solicitação rejeitada'); onOk(); onFechar(); }
  };
  return (
    <Modal titulo={`${b.tipo === 'BAIXA' ? 'Baixa' : 'Descarte'}: ${b.descricao}`} onFechar={onFechar} rodape={<>
      <button className="btn" onClick={onFechar}>Fechar</button>
      <button className="btn" disabled={acao.enviando || justificativa.length < 3} onClick={() => decidir(false)}>Rejeitar</button>
      <button className="btn perigo" disabled={acao.enviando || justificativa.length < 3} onClick={() => decidir(true)}>Aprovar {b.tipo === 'BAIXA' ? 'baixa' : 'descarte'}</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <dl className="dl"><dt>Status atual</dt><dd><Pill mapa={STATUS} valor={b.status} /></dd><dt>Motivo</dt><dd>{b.motivo}</dd>{b.certificado && <><dt>Certificado</dt><dd>{b.certificado}</dd></>}
        <dt>Custo acumulado</dt><dd>{moeda(b.custo_acumulado)} de {moeda(b.valor_aquisicao)}</dd><dt>Solicitante</dt><dd>{b.solicitante}</dd></dl>
      <div style={{ marginTop: 14 }}><Campo rotulo="Justificativa" obrigatorio><textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} /></Campo></div>
    </Modal>
  );
}
