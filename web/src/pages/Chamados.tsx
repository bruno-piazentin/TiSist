// Chamados: fila priorizada, detalhe com diagnóstico, orçamentos (cotações), movimentações e custos.
import { useState } from 'react';
import { api, baixarCsv } from '../api';
import {
  Campo, Carregando, Link, Modal, Opcoes, Pill, PRIORIDADE, SITUACAO_CHAMADO, STATUS, STATUS_ORC, TIPO_CUSTO, Tabela,
  Voltar, dataHora, moeda, num, useAcao, useApp, useCarregar, useForm,
} from '../ui';
import { DecidirOrcamento } from './Aprovacoes';
import { LancarCusto } from './Custos';

export function Chamados() {
  const { ref, navegar, avisar } = useApp();
  const [f, setF] = useState({ situacao: 'abertos', loja: '', prioridade: '', q: '' });
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const r = useCarregar(() => api('GET', '/api/chamados?' + params), [params]);
  return (
    <>
      <div className="topo">
        <div><div className="migalha">Operação</div><h1>Chamados</h1></div>
        <div className="acoes"><button className="btn" onClick={() => baixarCsv('/api/chamados?' + params, 'chamados').catch(e => avisar(e.message, 'erro'))}>Exportar CSV</button></div>
      </div>
      <div className="filtros">
        <input type="search" placeholder="Nº, equipamento, série ou relato…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <select value={f.situacao} onChange={e => setF({ ...f, situacao: e.target.value })}>
          <option value="abertos">Em aberto</option><option value="todos">Todos</option>
          {Object.entries(SITUACAO_CHAMADO).map(([k, s]) => <option key={k} value={k}>{s.rotulo}</option>)}
        </select>
        <Opcoes itens={ref.lojas} valor={f.loja} onChange={v => setF({ ...f, loja: v })} vazio="Todas as lojas" rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} />
        <select value={f.prioridade} onChange={e => setF({ ...f, prioridade: e.target.value })}><option value="">Todas as prioridades</option>{Object.entries(PRIORIDADE).map(([k, p]) => <option key={k} value={k}>{p.rotulo}</option>)}</select>
      </div>
      <div className="card">
        <Carregando {...r}>{() => <Tabela linhas={r.dados} onClick={l => navegar('/chamados/' + l.id)} vazio="Nenhum chamado" colunas={[
          { t: 'Nº', c: l => <strong>{l.numero}</strong> },
          { t: 'Prioridade', c: l => <Pill mapa={PRIORIDADE} valor={l.prioridade} /> },
          { t: 'Equipamento', c: l => <>{l.equipamento}<div className="muted small"><span className="mono">{l.modelo}</span> · {l.loja_codigo}</div></> },
          { t: 'Relato', c: l => <span className="small">{l.relato.length > 70 ? l.relato.slice(0, 70) + '…' : l.relato}</span>, movel: false },
          { t: 'Aberto', c: l => dataHora(l.aberto_em), movel: false },
          { t: 'Situação', c: l => <><Pill mapa={SITUACAO_CHAMADO} valor={l.situacao} />{l.reincidente && <span className="pill p-vermelho" style={{ marginLeft: 4 }}>reincidente</span>}{l.em_garantia && <span className="pill p-verde" style={{ marginLeft: 4 }}>garantia</span>}</> },
          { t: 'Sem movimento', num: true, c: l => l.situacao === 'ENCERRADO' || l.situacao === 'CANCELADO' ? '—' : `${num(l.dias_sem_movimento)} d`, movel: false },
        ]} />}</Carregando>
      </div>
    </>
  );
}

export function ChamadoDetalhe({ id }: { id: string }) {
  const { pode } = useApp();
  const r = useCarregar(() => api('GET', '/api/chamados/' + id), [id]);
  const [modal, setModal] = useState<'' | 'diag' | 'orc' | 'encerrar' | 'cancelar' | 'custo'>('');
  const [decidir, setDecidir] = useState<string | null>(null);
  return (
    <Carregando {...r}>{() => {
      const c = r.dados;
      const aberto = !['ENCERRADO', 'CANCELADO'].includes(c.situacao);
      const aprovado = c.orcamentos.find((o: any) => o.status === 'APROVADO');
      return (
        <>
          <Voltar padrao="/chamados" />
          <div className="topo">
            <div>
              <div className="migalha"><Link para="/chamados">Chamados</Link> / {c.loja_codigo}</div>
              <h1>Chamado nº {c.numero}</h1>
              <div className="muted small" style={{ marginTop: 4 }}><Link para={'/equipamentos/' + c.equipamento_id}>{c.equipamento}</Link> · <span className="mono">{c.numero_serie}</span> · {c.modelo}</div>
            </div>
            <div className="acoes">
              <Pill mapa={SITUACAO_CHAMADO} valor={c.situacao} /> <Pill mapa={PRIORIDADE} valor={c.prioridade} />
              {aberto && pode('chamado.tratar') && <button className="btn" onClick={() => setModal('diag')}>Diagnóstico</button>}
              {aberto && pode('orcamento.registrar') && !aprovado && <button className="btn primario" onClick={() => setModal('orc')}>Registrar orçamento</button>}
              {aberto && pode('chamado.tratar') && <button className="btn sucesso" onClick={() => setModal('encerrar')}>Encerrar</button>}
              {aberto && pode('chamado.tratar') && !aprovado && <button className="btn perigo" onClick={() => setModal('cancelar')}>Cancelar</button>}
              {pode('custo.lancar') && <button className="btn" onClick={() => setModal('custo')}>Lançar custo</button>}
            </div>
          </div>
          {c.em_garantia && <div className="aviso ok">Equipamento em garantia: acionar o fabricante antes de orçar com fornecedor local.</div>}
          {c.reincidente && <div className="aviso erro">Chamado reincidente: falha da mesma categoria neste equipamento dentro da janela configurada.</div>}

          <div className="grade g3" style={{ marginBottom: 16 }}>
            <div className="card span2"><h2>Problema e diagnóstico</h2><dl className="dl">
              <dt>Relato</dt><dd>{c.relato}</dd><dt>Categoria relatada</dt><dd>{c.categoria_relatada || '—'}</dd><dt>Categoria confirmada</dt><dd>{c.categoria_confirmada || '—'}</dd>
              <dt>Diagnóstico</dt><dd>{c.diagnostico || '—'}</dd><dt>Causa raiz</dt><dd>{c.causa_raiz || '—'}</dd>
              <dt>Fornecedor</dt><dd>{c.fornecedor || '—'}</dd><dt>Solicitante</dt><dd>{c.solicitante}</dd><dt>Técnico</dt><dd>{c.tecnico || '—'}</dd>
            </dl></div>
            <div className="card"><h2>Datas</h2><dl className="dl">
              {[['Abertura', c.aberto_em], ['Orçamento', c.orcamento_em], ['Aprovação', c.aprovado_em], ['Envio', c.enviado_em], ['Recebido fornecedor', c.recebido_fornecedor_em],
                ['Fim do reparo', c.reparo_fim_em], ['Retorno à loja', c.retorno_loja_em], ['Encerramento', c.encerrado_em]].flatMap(([t, d]) => [<dt key={t}>{t}</dt>, <dd key={t + 'v'}>{dataHora(d)}</dd>])}
              <dt>Equipamento</dt><dd><Pill mapa={STATUS} valor={c.status_equipamento} /></dd>
            </dl></div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-topo"><h2>Orçamentos e cotações</h2><span className="muted small">{c.orcamentos.filter((o: any) => o.status !== 'SUBSTITUIDO').length} cotação(ões)</span></div>
            <Tabela linhas={c.orcamentos} vazio="Nenhum orçamento registrado" colunas={[
              { t: 'Nº / versão', c: o => <strong>{o.numero} v{o.versao}</strong> }, { t: 'Fornecedor', c: o => o.fornecedor },
              { t: 'Peças', num: true, c: o => moeda(o.valor_pecas), movel: false }, { t: 'Mão de obra', num: true, c: o => moeda(o.valor_mao_obra), movel: false },
              { t: 'Frete + desl.', num: true, c: o => moeda(Number(o.valor_frete) + Number(o.valor_deslocamento)), movel: false },
              { t: 'Total', num: true, c: o => <strong>{moeda(o.valor_total)}</strong> }, { t: 'Status', c: o => <Pill mapa={STATUS_ORC} valor={o.status} /> },
              { t: 'Decisão', c: o => o.aprovador ? <span className="small">{o.aprovador}: {o.justificativa_decisao}</span> : ['RECEBIDO', 'EM_ANALISE'].includes(o.status) && pode('orcamento.aprovar') ? <button className="btn pequeno primario" onClick={() => setDecidir(o.id)}>Analisar</button> : '—' },
            ]} />
          </div>

          <div className="grade g2">
            <div className="card"><h2>Movimentações</h2>
              <ul className="timeline">{c.movimentacoes.map((m: any) => (
                <li key={m.id}><div className="quando">{dataHora(m.ocorrido_em)} · {m.usuario}</div>
                  <span className="transicao"><Pill mapa={STATUS} valor={m.status_anterior} /> → <Pill mapa={STATUS} valor={m.status_novo} /></span>
                  <div className="small" style={{ marginTop: 3 }}>{m.motivo}{m.documento_transporte && ` · doc. ${m.documento_transporte}`}</div></li>
              ))}</ul>
              {!c.movimentacoes.length && <div className="muted">Nenhuma movimentação.</div>}
            </div>
            <div className="card"><h2>Custos realizados</h2>
              <Tabela linhas={c.custos} vazio="Nenhum custo lançado" colunas={[{ t: 'Tipo', c: x => TIPO_CUSTO[x.tipo] }, { t: 'Competência', c: x => String(x.competencia).slice(0, 7) }, { t: 'Valor', num: true, c: x => moeda(x.valor) }]} />
              {aprovado && <div className="small" style={{ marginTop: 10 }}>Orçado: <strong>{moeda(aprovado.valor_total)}</strong> · Realizado: <strong>{moeda(c.custos.reduce((s: number, x: any) => s + Number(x.valor), 0))}</strong></div>}
            </div>
          </div>

          {modal === 'diag' && <Diagnostico c={c} onFechar={() => setModal('')} onOk={r.recarregar} />}
          {modal === 'orc' && <NovoOrcamento c={c} onFechar={() => setModal('')} onOk={r.recarregar} />}
          {modal === 'encerrar' && <Encerrar c={c} onFechar={() => setModal('')} onOk={r.recarregar} />}
          {modal === 'cancelar' && <Cancelar c={c} onFechar={() => setModal('')} onOk={r.recarregar} />}
          {modal === 'custo' && <LancarCusto inicial={{ equipamento_id: c.equipamento_id, chamado_id: c.id, fornecedor_id: c.fornecedor_id }} rotuloEquip={c.equipamento} onFechar={() => setModal('')} onOk={r.recarregar} />}
          {decidir && <DecidirOrcamento id={decidir} onFechar={() => setDecidir(null)} onOk={r.recarregar} />}
        </>
      );
    }}</Carregando>
  );
}

function Diagnostico({ c, onFechar, onOk }: any) {
  const { ref, avisar } = useApp();
  const { v, set } = useForm<any>({ diagnostico: c.diagnostico || '', causa_raiz: c.causa_raiz || '', categoria_falha_id: c.categoria_falha_id || c.categoria_falha_relatada_id || '', fornecedor_id: c.fornecedor_id || '', prioridade: c.prioridade });
  const acao = useAcao();
  const salvar = async () => {
    if (await acao.executar(() => api('PUT', '/api/chamados/' + c.id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]))))) { avisar('Diagnóstico registrado'); onOk(); onFechar(); }
  };
  return (
    <Modal titulo="Diagnóstico técnico" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <div className="campos">
        <Campo rotulo="Categoria confirmada"><Opcoes itens={ref.categorias} valor={v.categoria_falha_id} onChange={set('categoria_falha_id')} rotulo={x => x.nome} /></Campo>
        <Campo rotulo="Fornecedor responsável"><Opcoes itens={ref.fornecedores.filter((f: any) => f.homologado)} valor={v.fornecedor_id} onChange={set('fornecedor_id')} rotulo={f => f.razao_social} /></Campo>
        <Campo rotulo="Prioridade"><select value={v.prioridade} onChange={set('prioridade')}>{Object.entries(PRIORIDADE).map(([k, p]) => <option key={k} value={k}>{p.rotulo}</option>)}</select></Campo>
        <Campo rotulo="Diagnóstico" largo><textarea value={v.diagnostico} onChange={set('diagnostico')} /></Campo>
        <Campo rotulo="Causa raiz" largo><input value={v.causa_raiz} onChange={set('causa_raiz')} /></Campo>
      </div>
    </Modal>
  );
}

const ITEM_VAZIO = { tipo: 'PECA', descricao: '', quantidade: '1', valor_unitario: '' };
function NovoOrcamento({ c, onFechar, onOk }: any) {
  const { ref, avisar } = useApp();
  const { v, set } = useForm<any>({ fornecedor_id: c.fornecedor_id || '', validade: '', condicoes_pagamento: '', fornecedor_unico_justificativa: '' });
  const [itens, setItens] = useState<any[]>([{ ...ITEM_VAZIO }, { ...ITEM_VAZIO, tipo: 'MAO_DE_OBRA' }]);
  const acao = useAcao();
  const total = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0), 0);
  const setItem = (k: number, campo: string, valor: string) => setItens(l => l.map((i, j) => (j === k ? { ...i, [campo]: valor } : i)));
  const salvar = async () => {
    const validos = itens.filter(i => i.descricao && Number(i.valor_unitario) >= 0 && i.valor_unitario !== '');
    const r = await acao.executar(() => api('POST', '/api/orcamentos', { chamado_id: c.id, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x])), itens: validos }));
    if (r) { avisar(`Orçamento nº ${r.numero} registrado (${moeda(r.valor_total)})`); onOk(); onFechar(); }
  };
  return (
    <Modal largo titulo="Registrar orçamento" onFechar={onFechar} rodape={<><strong style={{ marginRight: 'auto' }}>Total: {moeda(total)}</strong><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando || !v.fornecedor_id} onClick={salvar}>Registrar</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <div className="campos">
        <Campo rotulo="Fornecedor (homologado)" obrigatorio><Opcoes itens={ref.fornecedores.filter((f: any) => f.homologado && !f.tipos.includes('TRANSPORTADORA'))} valor={v.fornecedor_id} onChange={set('fornecedor_id')} rotulo={f => f.razao_social} /></Campo>
        <Campo rotulo="Validade"><input type="date" value={v.validade} onChange={set('validade')} /></Campo>
        <Campo rotulo="Condições de pagamento"><input value={v.condicoes_pagamento} onChange={set('condicoes_pagamento')} placeholder="Ex.: 28 dias" /></Campo>
      </div>
      <h3 style={{ marginTop: 16 }}>Itens (peças, mão de obra, frete e deslocamento separados)</h3>
      <div style={{ display: 'grid', gap: 6 }}>
        {itens.map((i, k) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 80px 120px 32px', gap: 6 }}>
            <select value={i.tipo} onChange={e => setItem(k, 'tipo', e.target.value)}>{Object.entries(TIPO_CUSTO).map(([t, r]) => <option key={t} value={t}>{r}</option>)}</select>
            <input placeholder="Descrição" value={i.descricao} onChange={e => setItem(k, 'descricao', e.target.value)} />
            <input type="number" min="0" step="0.5" title="Quantidade" value={i.quantidade} onChange={e => setItem(k, 'quantidade', e.target.value)} />
            <input type="number" min="0" step="0.01" placeholder="Valor unit." value={i.valor_unitario} onChange={e => setItem(k, 'valor_unitario', e.target.value)} />
            <button className="btn pequeno" title="Remover" onClick={() => setItens(l => l.filter((_, j) => j !== k))}>×</button>
          </div>
        ))}
      </div>
      <button className="btn pequeno" style={{ marginTop: 8 }} onClick={() => setItens(l => [...l, { ...ITEM_VAZIO }])}>+ Item</button>
      <div style={{ marginTop: 14 }}><Campo rotulo="Justificativa de fornecedor único (quando não houver outras cotações)"><input value={v.fornecedor_unico_justificativa} onChange={set('fornecedor_unico_justificativa')} /></Campo></div>
    </Modal>
  );
}

function Encerrar({ c, onFechar, onOk }: any) {
  const { ref, avisar } = useApp();
  const { v, set } = useForm<any>({ categoria_falha_id: c.categoria_falha_id || c.categoria_falha_relatada_id || '', causa_raiz: c.causa_raiz || '', diagnostico: c.diagnostico || '' });
  const acao = useAcao();
  const salvar = async () => { if (await acao.executar(() => api('POST', `/api/chamados/${c.id}/encerrar`, v))) { avisar('Chamado encerrado'); onOk(); onFechar(); } };
  return (
    <Modal titulo="Encerrar chamado" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn sucesso" disabled={acao.enviando} onClick={salvar}>Encerrar</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      {c.status_equipamento !== 'ATIVO' && <div className="aviso atencao">O equipamento ainda está em “{STATUS[c.status_equipamento]?.rotulo}”. Registre o retorno com teste antes de encerrar.</div>}
      <div className="campos">
        <Campo rotulo="Categoria de falha confirmada" obrigatorio largo><Opcoes itens={ref.categorias} valor={v.categoria_falha_id} onChange={set('categoria_falha_id')} rotulo={x => x.nome} /></Campo>
        <Campo rotulo="Causa raiz" obrigatorio largo><input value={v.causa_raiz} onChange={set('causa_raiz')} /></Campo>
        <Campo rotulo="Diagnóstico final" largo><textarea value={v.diagnostico} onChange={set('diagnostico')} /></Campo>
      </div>
      <p className="muted small">A categoria confirmada alimenta os indicadores de reincidência por equipamento e por modelo.</p>
    </Modal>
  );
}

function Cancelar({ c, onFechar, onOk }: any) {
  const { avisar } = useApp();
  const { v, set } = useForm<any>({ motivo: '', teste_ok: false });
  const acao = useAcao();
  const salvar = async () => { if (await acao.executar(() => api('POST', `/api/chamados/${c.id}/cancelar`, v))) { avisar('Chamado cancelado e equipamento de volta a Ativo'); onOk(); onFechar(); } };
  return (
    <Modal titulo="Cancelar chamado" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Voltar</button><button className="btn perigo" disabled={acao.enviando} onClick={salvar}>Cancelar chamado</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <Campo rotulo="Motivo (resolvido sem custo, chamado indevido…)" obrigatorio><textarea value={v.motivo} onChange={set('motivo')} /></Campo>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={v.teste_ok} onChange={set('teste_ok')} /> Equipamento testado e funcionando</label>
    </Modal>
  );
}
