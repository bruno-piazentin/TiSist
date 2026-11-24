// Custos: lançamentos reais (NF), estornos e fechamento mensal por competência.
import { useState } from 'react';
import { api, baixarCsv } from '../api';
import { Campo, Carregando, Modal, Opcoes, TIPO_CUSTO, Tabela, dataHora, moeda, useAcao, useApp, useCarregar, useForm } from '../ui';

export function Custos() {
  const { ref, pode, avisar } = useApp();
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7));
  const [loja, setLoja] = useState('');
  const [modal, setModal] = useState<'' | 'lancar' | 'fechar'>('');
  const [estornar, setEstornar] = useState<any>(null);
  const q = `competencia=${competencia}${loja ? '&loja=' + loja : ''}`;
  const r = useCarregar(() => api('GET', '/api/custos?' + q), [q]);
  const fech = useCarregar(() => api('GET', '/api/fechamentos'), []);
  const fechado = fech.dados?.find((f: any) => String(f.competencia).startsWith(competencia))?.fechado_em;

  return (
    <>
      <div className="topo">
        <div><div className="migalha">Operação</div><h1>Custos</h1></div>
        <div className="acoes">
          <button className="btn" onClick={() => baixarCsv('/api/custos?' + q, 'custos-' + competencia).catch(e => avisar(e.message, 'erro'))}>Exportar CSV (ERP)</button>
          {pode('custo.fechar') && <button className="btn" onClick={() => setModal('fechar')}>Fechar competência</button>}
          {pode('custo.lancar') && <button className="btn primario" onClick={() => setModal('lancar')}>Lançar custo</button>}
        </div>
      </div>
      <div className="filtros">
        <input type="month" aria-label="Competência" value={competencia} onChange={e => setCompetencia(e.target.value)} />
        <Opcoes itens={ref.lojas} valor={loja} onChange={setLoja} vazio="Todas as lojas" rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} />
        {fechado && <span className="pill p-cinza" style={{ alignSelf: 'center' }}>Competência fechada em {dataHora(fechado)}</span>}
      </div>
      <div className="grade g3">
        <div className="card span2">
          <Carregando {...r}>{() => {
            const total = r.dados.reduce((s: number, c: any) => s + Number(c.valor), 0);
            return <>
              <div className="card-topo"><h2>Lançamentos</h2><strong>{moeda(total)}</strong></div>
              <Tabela linhas={r.dados} vazio="Nenhum lançamento na competência" colunas={[
                { t: 'Lançado em', c: c => dataHora(c.registrado_em), movel: false },
                { t: 'Loja', c: c => c.loja_codigo },
                { t: 'Equipamento', c: c => <>{c.equipamento}<div className="muted small">{c.departamento}{c.chamado_numero ? ` · chamado ${c.chamado_numero}` : ''}</div></> },
                { t: 'Tipo', c: c => TIPO_CUSTO[c.tipo] },
                { t: 'Fornecedor', c: c => c.fornecedor || '—', movel: false },
                { t: 'Valor', num: true, c: c => <span style={{ color: c.valor < 0 ? 'var(--vermelho)' : undefined }}>{moeda(c.valor)}</span> },
                { t: '', c: c => c.estornado ? <span className="pill p-cinza">estornado</span> : c.estorno_de ? <span className="pill p-ambar">estorno</span>
                                 : pode('custo.lancar') ? <button className="btn pequeno perigo" onClick={() => setEstornar(c)}>Estornar</button> : null },
              ]} />
            </>;
          }}</Carregando>
        </div>
        <div className="card">
          <h2>Competências</h2>
          <Carregando {...fech}>{() => <Tabela linhas={fech.dados} chave="competencia" onClick={f => setCompetencia(String(f.competencia).slice(0, 7))} colunas={[
            { t: 'Mês', c: f => String(f.competencia).slice(0, 7) }, { t: 'Total', num: true, c: f => moeda(f.total, true) },
            { t: '', c: f => f.fechado_em ? <span className="pill p-cinza">fechada</span> : <span className="pill p-verde">aberta</span> },
          ]} />}</Carregando>
        </div>
      </div>
      {modal === 'lancar' && <LancarCusto onFechar={() => setModal('')} onOk={() => { r.recarregar(); fech.recarregar(); }} />}
      {modal === 'fechar' && <FecharCompetencia onFechar={() => setModal('')} onOk={fech.recarregar} />}
      {estornar && <Estornar c={estornar} onFechar={() => setEstornar(null)} onOk={() => { r.recarregar(); fech.recarregar(); }} />}
    </>
  );
}

/** Lançamento de custo real. Pode vir pré-preenchido a partir de um chamado. */
export function LancarCusto({ inicial = {}, rotuloEquip, onFechar, onOk }: { inicial?: any; rotuloEquip?: string; onFechar: () => void; onOk: () => void }) {
  const { ref, avisar } = useApp();
  const { v, set } = useForm<any>({ equipamento_id: '', chamado_id: '', fornecedor_id: '', tipo: 'PECA', valor: '', competencia: new Date().toISOString().slice(0, 7), nfe_chave: '', ...inicial });
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<any[]>([]);
  const [escolhido, setEscolhido] = useState<string>(rotuloEquip || '');
  const acao = useAcao();
  const procurar = async (t: string) => { setBusca(t); if (t.length >= 3) setAchados(await api('GET', '/api/equipamentos?limit=10&q=' + encodeURIComponent(t)).catch(() => [])); };
  const salvar = async () => {
    const r = await acao.executar(() => api('POST', '/api/custos', Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]))));
    if (r) { avisar(r.aviso ? 'Custo lançado. Atenção: ' + r.aviso : 'Custo lançado', r.aviso ? 'erro' : 'ok'); onOk(); onFechar(); }
  };
  return (
    <Modal titulo="Lançar custo real" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando || !v.equipamento_id || !v.valor} onClick={salvar}>Lançar</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="campos">
        {inicial.equipamento_id ? <Campo rotulo="Equipamento" largo><input disabled value={escolhido} /></Campo> : (
          <Campo rotulo="Equipamento" obrigatorio largo>
            {escolhido ? <div style={{ display: 'flex', gap: 8 }}><input disabled value={escolhido} /><button className="btn pequeno" onClick={() => { setEscolhido(''); set('equipamento_id')(''); }}>Trocar</button></div> : <>
              <input placeholder="Buscar por série, patrimônio ou descrição (mín. 3 letras)" value={busca} onChange={e => procurar(e.target.value)} />
              {achados.map(a => <button key={a.id} className="btn pequeno" style={{ marginTop: 4, justifyContent: 'flex-start' }} onClick={() => { set('equipamento_id')(a.id); setEscolhido(`${a.descricao} (${a.numero_serie}) – ${a.loja_codigo}`); }}>{a.descricao} · {a.numero_serie} · {a.loja_codigo}</button>)}
            </>}
          </Campo>
        )}
        <Campo rotulo="Tipo" obrigatorio><select value={v.tipo} onChange={set('tipo')}>{Object.entries(TIPO_CUSTO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
        <Campo rotulo="Valor (R$)" obrigatorio><input type="number" min="0.01" step="0.01" value={v.valor} onChange={set('valor')} /></Campo>
        <Campo rotulo="Competência" obrigatorio><input type="month" value={v.competencia} onChange={set('competencia')} /></Campo>
        <Campo rotulo="Fornecedor"><Opcoes itens={ref.fornecedores} valor={v.fornecedor_id} onChange={set('fornecedor_id')} rotulo={f => f.razao_social} /></Campo>
        <Campo rotulo="Chave da NF-e (44 dígitos)" largo><input value={v.nfe_chave} onChange={set('nfe_chave')} inputMode="numeric" maxLength={44} /></Campo>
      </div>
      <p className="muted small">Loja e departamento são gravados conforme o equipamento hoje. Lançamentos não se editam: correções são feitas por estorno.</p>
    </Modal>
  );
}

function Estornar({ c, onFechar, onOk }: any) {
  const { avisar } = useApp();
  const [motivo, setMotivo] = useState('');
  const acao = useAcao();
  const salvar = async () => { if (await acao.executar(() => api('POST', `/api/custos/${c.id}/estornar`, { motivo }))) { avisar('Estorno lançado'); onOk(); onFechar(); } };
  return (
    <Modal titulo="Estornar lançamento" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn perigo" disabled={acao.enviando || motivo.length < 5} onClick={salvar}>Estornar {moeda(c.valor)}</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <p>{TIPO_CUSTO[c.tipo]} de {moeda(c.valor)} em {c.equipamento} ({String(c.competencia).slice(0, 7)}). Se a competência estiver fechada, o estorno entra no mês corrente.</p>
      <Campo rotulo="Motivo" obrigatorio><textarea value={motivo} onChange={e => setMotivo(e.target.value)} /></Campo>
    </Modal>
  );
}

function FecharCompetencia({ onFechar, onOk }: any) {
  const { avisar } = useApp();
  const anterior = new Date(); anterior.setMonth(anterior.getMonth() - 1);
  const [competencia, setCompetencia] = useState(anterior.toISOString().slice(0, 7));
  const acao = useAcao();
  const salvar = async () => { const r = await acao.executar(() => api('POST', '/api/fechamentos', { competencia })); if (r) { avisar(`Competência ${competencia} fechada`); onOk(); onFechar(); } };
  return (
    <Modal titulo="Fechar competência" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>Fechar</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="aviso atencao">Depois de fechada, a competência não recebe lançamentos. Notas atrasadas entram no mês aberto.</div>
      <Campo rotulo="Competência"><input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} /></Campo>
    </Modal>
  );
}
