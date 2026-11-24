// Equipamentos: lista, leitura de código, cadastro, detalhe com histórico, movimentação, chamado e baixa.
import { useEffect, useMemo, useRef, useState } from 'react';
import { acaoOffline, api, baixarCsv, getComCache, ErroApi } from '../api';
import { cache, uuid } from '../offline';
import {
  Campo, Carregando, Link, Modal, Opcoes, Pill, PRIORIDADE, SITUACAO_CHAMADO, STATUS, TIPO_CUSTO, Tabela,
  Voltar, data, dataHora, moeda, num, useAcao, useApp, useCarregar, useForm,
} from '../ui';

// ======================= LISTA =======================
export function Equipamentos() {
  const { ref, navegar, pode, avisar } = useApp();
  const qs = new URLSearchParams(location.search);
  const [f, setF] = useState({ q: '', loja: qs.get('loja') || '', status: qs.get('status') || '', grupo: '' });
  const [ler, setLer] = useState(false);
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const r = useCarregar(() => getComCache(`/api/equipamentos?limit=2000&${params}`), [params]);
  // Guarda a lista completa da(s) loja(s) para consulta offline
  useEffect(() => { if (r.dados && !r.dados.offline && !params) cache.set('equipamentos', r.dados.dados).catch(() => {}); }, [r.dados, params]);

  return (
    <>
      <div className="topo">
        <div><div className="migalha">Operação</div><h1>Equipamentos</h1></div>
        <div className="acoes">
          <button className="btn" onClick={() => setLer(true)}>Ler código</button>
          <button className="btn" onClick={() => baixarCsv(`/api/equipamentos?${params}`, 'equipamentos').catch(e => avisar(e.message, 'erro'))}>Exportar CSV</button>
          {pode('equipamento.gerir') && <button className="btn primario" onClick={() => navegar('/equipamentos/novo')}>Novo equipamento</button>}
        </div>
      </div>
      <div className="filtros">
        <input type="search" aria-label="Pesquisar equipamentos" placeholder="Buscar descrição, série, patrimônio, modelo ou ponto…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <Opcoes itens={ref.lojas} valor={f.loja} onChange={v => setF({ ...f, loja: v })} vazio="Todas as lojas" rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} />
        <Opcoes itens={Object.entries(STATUS).map(([k, s]) => ({ valor: k, nome: s.rotulo }))} valor={f.status} onChange={v => setF({ ...f, status: v })} vazio="Todos os status" rotulo={s => s.nome} />
        <Opcoes itens={ref.grupos} valor={f.grupo} onChange={v => setF({ ...f, grupo: v })} vazio="Todos os grupos" rotulo={g => g.nome} />
      </div>
      <div className="card">
        <Carregando {...r}>{() => {
          const { dados, offline } = r.dados!;
          return (
            <>
              <div className="card-topo"><span className="muted small">{dados.length} equipamento(s){offline && ' · cópia offline'}</span></div>
              <Tabela linhas={dados} onClick={l => navegar('/equipamentos/' + l.id)} colunas={[
                { t: 'Equipamento', c: l => <><strong>{l.descricao}</strong><div className="muted small mono">{l.numero_serie}{l.patrimonio ? ' · ' + l.patrimonio : ''}</div></> },
                { t: 'Modelo', c: l => <><span className="mono">{l.modelo}</span><div className="muted small">{l.marca}</div></>, movel: false },
                { t: 'Loja', c: l => l.loja_codigo },
                { t: 'Departamento', c: l => l.departamento, movel: false },
                { t: 'Ponto', c: l => l.ponto_instalacao || '—', movel: false },
                { t: 'Status', c: l => <Pill mapa={STATUS} valor={l.status} /> },
                { t: 'Garantia', c: l => l.em_garantia ? <span className="pill p-verde">até {data(l.garantia_fim)}</span> : <span className="muted small">{l.garantia_fim ? 'vencida' : '—'}</span>, movel: false },
              ]} />
            </>
          );
        }}</Carregando>
      </div>
      {ler && <LerCodigo onFechar={() => setLer(false)} />}
    </>
  );
}

// ======================= LEITURA DE CÓDIGO =======================
// Funciona com leitor USB (digita o código e Enter) ou com a câmera, quando o navegador suporta BarcodeDetector.
function LerCodigo({ onFechar }: { onFechar: () => void }) {
  const { navegar } = useApp();
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const temDetector = 'BarcodeDetector' in window;

  const buscar = async (c: string) => {
    setErro('');
    try { const e = await api('GET', '/api/equipamentos/busca/' + encodeURIComponent(c.trim())); onFechar(); navegar('/equipamentos/' + e.id); }
    catch (er: any) {
      // offline: procura na lista guardada no aparelho
      const lista = (await cache.get<any[]>('equipamentos')) || [];
      const e = lista.find(x => [x.qr_code, x.patrimonio, x.numero_serie].includes(c.trim()));
      if (e) { onFechar(); navegar('/equipamentos/' + e.id); } else setErro(er instanceof ErroApi ? er.message : 'Não encontrado (sem conexão e fora da cópia local)');
    }
  };
  useEffect(() => {
    if (!camera) return;
    let parar = false; let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current!.srcObject = stream; await video.current!.play();
        const det = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
        while (!parar) {
          const r = await det.detect(video.current!).catch(() => []);
          if (r[0]?.rawValue) { parar = true; buscar(r[0].rawValue); break; }
          await new Promise(res => setTimeout(res, 300));
        }
      } catch { setErro('Não foi possível usar a câmera'); setCamera(false); }
    })();
    return () => { parar = true; stream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return (
    <Modal titulo="Ler código do equipamento" onFechar={onFechar}>
      <form onSubmit={e => { e.preventDefault(); buscar(codigo); }}>
        {erro && <div className="aviso erro" role="alert">{erro}</div>}
        <Campo rotulo="QR code, patrimônio ou número de série"><input autoFocus value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Aponte o leitor ou digite" /></Campo>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn primario">Buscar</button>
          {temDetector && <button type="button" className="btn" onClick={() => setCamera(c => !c)}>{camera ? 'Parar câmera' : 'Usar câmera'}</button>}
        </div>
        {camera && <video ref={video} style={{ width: '100%', marginTop: 12, borderRadius: 8 }} muted playsInline />}
      </form>
    </Modal>
  );
}

// ======================= NOVO =======================
export function EquipamentoNovo() {
  const { ref, navegar, avisar, usuario } = useApp();
  const { v, set, setV } = useForm<any>({ produto_id: '', loja_id: usuario.lojas.length === 1 ? usuario.lojas[0] : '', departamento_id: '', descricao: '', numero_serie: '', cor: '', status: 'ATIVO',
    patrimonio: '', data_aquisicao: '', nota_fiscal: '', valor_aquisicao: '', garantia_fim: '', ponto_instalacao: '', setor_instalacao: '', ip: '', mac: '', hostname: '', firmware_versao: '', responsavel_uso: '' });
  const acao = useAcao();
  const prod = ref.produtos.find((p: any) => p.id === v.produto_id);
  useEffect(() => { if (prod) setV((s: any) => ({ ...s, cor: s.cor || prod.cor_padrao || '', descricao: s.descricao || prod.descricao })); }, [v.produto_id]); // eslint-disable-line
  const nome = (lista: any[], id: string, campo = 'nome') => lista.find(x => x.id === id)?.[campo] || '—';

  const salvar = async (confirmar = false) => {
    const corpo = Object.fromEntries(Object.entries({ ...v, confirmar_serie_outro_modelo: confirmar }).map(([k, x]) => [k, x === '' ? null : x]));
    const r = await acao.executar(async () => {
      try { return await api('POST', '/api/equipamentos', corpo); }
      catch (e: any) {
        if (e instanceof ErroApi && e.detalhes?.codigo === 'SERIE_OUTRO_MODELO' && confirm(e.message)) return api('POST', '/api/equipamentos', { ...corpo, confirmar_serie_outro_modelo: true });
        throw e;
      }
    });
    if (r) { avisar(`Equipamento cadastrado (${r.numero_serie})`); navegar('/equipamentos/' + r.id); }
  };

  return (
    <>
      <Voltar padrao="/equipamentos" />
      <div className="topo"><div><div className="migalha"><Link para="/equipamentos">Equipamentos</Link></div><h1>Novo equipamento</h1></div></div>
      <form className="card" onSubmit={e => { e.preventDefault(); salvar(); }}>
        {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
        <h3>Obrigatórios</h3>
        <div className="campos">
          <Campo rotulo="Descrição" obrigatorio><input required autoFocus value={v.descricao} onChange={set('descricao')} placeholder="Vazio = descrição do modelo" /></Campo>
          <Campo rotulo="Modelo (catálogo)" obrigatorio><Opcoes obrigatorio itens={ref.produtos.filter((p: any) => p.ativo_catalogo)} valor={v.produto_id} onChange={set('produto_id')} rotulo={p => `${p.modelo} – ${p.descricao}`} /></Campo>
          <Campo rotulo="Marca"><input disabled value={prod ? nome(ref.marcas, prod.marca_id) : ''} /></Campo>
          <Campo rotulo="Fabricante"><input disabled value={prod ? nome(ref.fabricantes, prod.fabricante_id, 'razao_social') : ''} /></Campo>
          <Campo rotulo="Grupo"><input disabled value={prod ? nome(ref.grupos, prod.grupo_id) : ''} /></Campo>
          <Campo rotulo="Número de série"><input value={v.numero_serie} onChange={set('numero_serie')} placeholder="Vazio = código interno" /></Campo>
          <Campo rotulo="Cor" obrigatorio><input required value={v.cor} onChange={set('cor')} /></Campo>
          <Campo rotulo="Loja vinculada" obrigatorio><Opcoes obrigatorio itens={ref.lojas.filter((l: any) => l.situacao !== 'FECHADA')} valor={v.loja_id} onChange={set('loja_id')} rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} /></Campo>
          <Campo rotulo="Departamento" obrigatorio><Opcoes obrigatorio itens={ref.departamentos.filter((d: any) => d.ativo)} valor={v.departamento_id} onChange={set('departamento_id')} rotulo={d => d.nome} /></Campo>
          <Campo rotulo="Status inicial" obrigatorio>
            <select value={v.status} onChange={set('status')}><option value="ATIVO">Ativo / em loja</option><option value="EM_ESTOQUE">Em estoque</option><option value="EM_RESERVA">Em reserva</option></select>
          </Campo>
        </div>
        <h3 style={{ marginTop: 20 }}>Aquisição e garantia</h3>
        <div className="campos">
          <Campo rotulo="Patrimônio"><input value={v.patrimonio} onChange={set('patrimonio')} /></Campo>
          <Campo rotulo="Data de aquisição"><input type="date" value={v.data_aquisicao} onChange={set('data_aquisicao')} /></Campo>
          <Campo rotulo="Nota fiscal"><input value={v.nota_fiscal} onChange={set('nota_fiscal')} /></Campo>
          <Campo rotulo="Valor de aquisição (R$)"><input type="number" step="0.01" min="0" value={v.valor_aquisicao} onChange={set('valor_aquisicao')} /></Campo>
          <Campo rotulo="Fim da garantia"><input type="date" value={v.garantia_fim} onChange={set('garantia_fim')} placeholder="automático" /></Campo>
        </div>
        <p className="muted small">Sem fim de garantia informado, o sistema usa a data de aquisição + garantia padrão do modelo{prod ? ` (${prod.garantia_meses} meses)` : ''}.</p>
        <h3 style={{ marginTop: 20 }}>Localização e rede</h3>
        <div className="campos">
          <Campo rotulo="Setor"><input value={v.setor_instalacao} onChange={set('setor_instalacao')} /></Campo>
          <Campo rotulo="Ponto de instalação"><input value={v.ponto_instalacao} onChange={set('ponto_instalacao')} placeholder="Ex.: Checkout 05" /></Campo>
          <Campo rotulo="Responsável pelo uso"><input value={v.responsavel_uso} onChange={set('responsavel_uso')} /></Campo>
          <Campo rotulo="IP"><input value={v.ip} onChange={set('ip')} /></Campo>
          <Campo rotulo="MAC"><input value={v.mac} onChange={set('mac')} placeholder="00:11:22:33:44:55" /></Campo>
          <Campo rotulo="Hostname"><input value={v.hostname} onChange={set('hostname')} /></Campo>
          <Campo rotulo="Versão de firmware"><input value={v.firmware_versao} onChange={set('firmware_versao')} /></Campo>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn primario" disabled={acao.enviando}>{acao.enviando ? 'Salvando…' : 'Cadastrar'}</button>
          <button type="button" className="btn" onClick={() => navegar('/equipamentos')}>Cancelar</button>
        </div>
      </form>
    </>
  );
}

// ======================= DETALHE =======================
const TITULO_EVENTO: Record<string, string> = {
  STATUS_ALTERADO: 'Movimentação de status', CHAMADO_ABERTO: 'Chamado aberto', CHAMADO_ENCERRADO: 'Chamado encerrado', CHAMADO_CANCELADO: 'Chamado cancelado',
  CHAMADO_EM_ORCAMENTO: 'Chamado em orçamento', CHAMADO_EM_REPARO: 'Chamado em reparo', CHAMADO_EM_RETORNO: 'Equipamento em retorno', DIAGNOSTICO_REGISTRADO: 'Diagnóstico registrado',
  ORCAMENTO_REGISTRADO: 'Orçamento registrado', ORCAMENTO_APROVADO: 'Orçamento aprovado', ORCAMENTO_REPROVADO: 'Orçamento reprovado', ORCAMENTO_SUBSTITUIDO: 'Orçamento substituído por nova versão',
  CUSTO_LANCADO: 'Custo lançado', CUSTO_ESTORNADO: 'Custo estornado', ESTORNO_MOTIVO: 'Motivo do estorno', CADASTRO_ALTERADO: 'Alteração cadastral', EQUIPAMENTO_CADASTRADO: 'Equipamento cadastrado',
};
function classeEvento(t: string) { return t.startsWith('CUSTO') || t === 'ESTORNO_MOTIVO' ? 't-custo' : t.startsWith('ORCAMENTO') ? 't-orc' : t.startsWith('CHAMADO') || t === 'DIAGNOSTICO_REGISTRADO' ? 't-cham' : t.startsWith('CADASTRO') || t === 'EQUIPAMENTO_CADASTRADO' ? 't-cad' : ''; }

function DescricaoEvento({ ev }: { ev: any }) {
  const p = ev.payload || {};
  if (ev.tipo === 'STATUS_ALTERADO') return (
    <div><span className="transicao"><Pill mapa={STATUS} valor={p.status_anterior} /> → <Pill mapa={STATUS} valor={p.status_novo} /></span>
      {p.motivo && <div className="small" style={{ marginTop: 4 }}>{p.motivo}</div>}{p.documento && <div className="small muted">Documento: {p.documento}</div>}</div>);
  if (ev.tipo.startsWith('CUSTO')) return <div className="small">{TIPO_CUSTO[p.tipo] || p.tipo}: <strong>{moeda(p.valor)}</strong> · competência {String(p.competencia).slice(0, 7)}</div>;
  if (ev.tipo.startsWith('ORCAMENTO')) return <div className="small">Nº {p.numero} v{p.versao} · {moeda(p.valor_total)}{p.justificativa ? ` · ${p.justificativa}` : ''}</div>;
  if (ev.tipo === 'CHAMADO_ABERTO') return <div className="small">Nº {p.numero} · {p.relato}{p.reincidente && <span className="pill p-vermelho" style={{ marginLeft: 6 }}>reincidente</span>}{p.em_garantia && <span className="pill p-verde" style={{ marginLeft: 6 }}>em garantia</span>}</div>;
  if (ev.tipo.startsWith('CHAMADO') || ev.tipo === 'DIAGNOSTICO_REGISTRADO') return <div className="small">Nº {p.numero}{p.causa_raiz ? ` · causa: ${p.causa_raiz}` : ''}{p.diagnostico ? ` · ${p.diagnostico}` : ''}</div>;
  if (ev.tipo === 'CADASTRO_ALTERADO' && p.anterior) return <div className="small">{Object.keys(p.novo || {}).filter(k => JSON.stringify(p.anterior[k]) !== JSON.stringify(p.novo[k])).map(k => <div key={k}>{k}: <s className="muted">{String(p.anterior[k] ?? '—')}</s> → {String(p.novo[k] ?? '—')}</div>)}</div>;
  return null;
}

export function EquipamentoDetalhe({ id }: { id: string }) {
  const { ref, pode, online, usuario } = useApp();
  const [aba, setAba] = useState<'dados' | 'historico' | 'chamados' | 'custos'>('historico');
  const [modal, setModal] = useState<'' | 'mov' | 'chamado' | 'baixa' | 'editar'>('');
  const r = useCarregar(() => getComCache('/api/equipamentos/' + id), [id]);
  const h = useCarregar(() => getComCache(`/api/equipamentos/${id}/historico`), [id]);
  const recarregar = () => { r.recarregar(); h.recarregar(); };

  return (
    <Carregando {...r}>{() => {
      const { dados: e, offline } = r.dados!;
      const transicoes = e.transicoes.filter((t: any) => !(offline || !online) || !(t.de === 'ATIVO' && t.para === 'TRANSITO'));
      return (
        <>
          <Voltar padrao="/equipamentos" />
          <div className="topo">
            <div>
              <div className="migalha"><Link para="/equipamentos">Equipamentos</Link> / {e.loja_codigo}</div>
              <h1>{e.descricao}</h1>
              <div className="muted small" style={{ marginTop: 4 }}>
                <span className="mono">{e.numero_serie}</span>{e.serie_gerada && ' (código interno)'} · {e.modelo} · {e.marca} · {e.loja}
              </div>
            </div>
            <div className="acoes">
              <Pill mapa={STATUS} valor={e.status} />
              {pode('chamado.abrir') && !e.chamado_aberto && !['BAIXADO', 'DESCARTADO'].includes(e.status) && <button className="btn primario" onClick={() => setModal('chamado')}>Abrir chamado</button>}
              {pode('movimentar') && transicoes.length > 0 && (usuario.perfil !== 'GERENTE_LOJA' || ['TRANSITO', 'EM_MANUTENCAO'].includes(e.status)) && <button className="btn" onClick={() => setModal('mov')}>Movimentar</button>}
              {pode('equipamento.gerir') && !offline && <button className="btn" onClick={() => setModal('editar')}>Editar</button>}
              {pode('baixa.solicitar') && !offline && !e.baixa_pendente && !['DESCARTADO'].includes(e.status) && <button className="btn perigo" onClick={() => setModal('baixa')}>{e.status === 'BAIXADO' ? 'Solicitar descarte' : 'Solicitar baixa'}</button>}
            </div>
          </div>
          {offline && <div className="aviso atencao">Exibindo cópia guardada no aparelho.</div>}
          {e.chamado_aberto && <div className="aviso info">Chamado <Link para={'/chamados/' + e.chamado_aberto.id}>nº {e.chamado_aberto.numero}</Link> em andamento ({SITUACAO_CHAMADO[e.chamado_aberto.situacao]?.rotulo}).</div>}
          {e.baixa_pendente && <div className="aviso atencao">Solicitação de {e.baixa_pendente.tipo.toLowerCase()} aguardando aprovação: {e.baixa_pendente.motivo}</div>}
          {e.custo?.sugerir_substituicao && <div className="aviso erro" role="alert">Custo acumulado já atingiu {num(e.custo.pct_aquisicao, 0)}% do valor de compra: avaliar substituição.</div>}

          <div className="grade g4" style={{ marginBottom: 16 }}>
            <div className="card kpi"><div className="rotulo">Local atual</div><div className="valor" style={{ fontSize: 17 }}>{e.local_tipo === 'FORNECEDOR' ? e.local_fornecedor : e.local_loja}</div><div className="sub">{e.local_tipo === 'FORNECEDOR' ? 'no fornecedor' : e.ponto_instalacao || e.departamento}</div></div>
            <div className="card kpi"><div className="rotulo">Custo acumulado</div><div className="valor">{moeda(e.custo?.custo_acumulado, true)}</div><div className="sub">{e.valor_aquisicao ? `${num(e.custo?.pct_aquisicao || 0, 0)}% de ${moeda(e.valor_aquisicao, true)}` : 'valor de compra não informado'}</div></div>
            <div className="card kpi"><div className="rotulo">Chamados</div><div className="valor">{num(e.resumo_chamados?.total)}</div><div className="sub">{num(e.resumo_chamados?.reincidentes)} reincidente(s)</div></div>
            <div className="card kpi"><div className="rotulo">Garantia</div><div className="valor" style={{ fontSize: 17 }}>{e.garantia_fim ? data(e.garantia_fim) : '—'}</div><div className="sub">{e.em_garantia ? 'vigente' : e.garantia_fim ? 'vencida' : 'não informada'}</div></div>
          </div>

          <div className="abas">
            {([['historico', 'Histórico'], ['dados', 'Dados'], ['chamados', 'Chamados'], ['custos', 'Custos']] as const).map(([k, t]) => <button key={k} className={aba === k ? 'ativa' : ''} onClick={() => setAba(k)}>{t}</button>)}
          </div>
          {aba === 'historico' && (
            <div className="card">
              <div className="card-topo"><h2>Linha do tempo</h2><button className="btn pequeno" onClick={() => window.print()}>Imprimir / PDF</button></div>
              <Carregando {...h}>{() => (
                <ul className="timeline">
                  {h.dados!.dados.map((ev: any) => (
                    <li key={ev.id} className={classeEvento(ev.tipo)}>
                      <div className="quando">{dataHora(ev.ocorrido_em)} · {ev.usuario || 'sistema'}{Math.abs(new Date(ev.registrado_em).getTime() - new Date(ev.ocorrido_em).getTime()) > 120000 && ` · sincronizado em ${dataHora(ev.registrado_em)}`}</div>
                      <div className="titulo">{TITULO_EVENTO[ev.tipo] || ev.tipo}</div>
                      <DescricaoEvento ev={ev} />
                    </li>
                  ))}
                </ul>
              )}</Carregando>
            </div>
          )}
          {aba === 'dados' && (
            <div className="grade g2">
              <div className="card"><h2>Identificação</h2><dl className="dl">
                <dt>Descrição</dt><dd>{e.descricao}</dd><dt>Nº de série</dt><dd className="mono">{e.numero_serie}</dd><dt>Patrimônio</dt><dd>{e.patrimonio || '—'}</dd>
                <dt>QR code</dt><dd className="mono">{e.qr_code}</dd><dt>Modelo</dt><dd>{e.modelo} – {e.produto_descricao}</dd><dt>Marca</dt><dd>{e.marca}</dd>
                <dt>Fabricante</dt><dd>{e.fabricante}</dd><dt>Grupo</dt><dd>{e.grupo}</dd><dt>Cor</dt><dd>{e.cor}</dd>
                <dt>Loja vinculada</dt><dd>{e.loja_codigo} – {e.loja}</dd><dt>Departamento</dt><dd>{e.departamento}</dd>
              </dl></div>
              <div className="card"><h2>Aquisição, garantia e rede</h2><dl className="dl">
                <dt>Aquisição</dt><dd>{data(e.data_aquisicao)}</dd><dt>Nota fiscal</dt><dd>{e.nota_fiscal || '—'}</dd><dt>Valor</dt><dd>{moeda(e.valor_aquisicao)}</dd>
                <dt>Garantia</dt><dd>{data(e.garantia_inicio)} a {data(e.garantia_fim)} {e.garantia_tipo && `(${e.garantia_tipo.toLowerCase()})`}</dd>
                <dt>Setor / ponto</dt><dd>{[e.setor_instalacao, e.ponto_instalacao].filter(Boolean).join(' · ') || '—'}</dd><dt>Responsável</dt><dd>{e.responsavel_uso || '—'}</dd>
                <dt>IP / MAC</dt><dd className="mono">{e.ip || '—'} / {e.mac || '—'}</dd><dt>Hostname</dt><dd className="mono">{e.hostname || '—'}</dd><dt>Firmware</dt><dd>{e.firmware_versao || '—'}</dd>
              </dl></div>
            </div>
          )}
          {aba === 'chamados' && <ChamadosDoEquipamento id={id} />}
          {aba === 'custos' && <CustosDoEquipamento id={id} />}

          {modal === 'mov' && <Movimentar e={e} transicoes={transicoes} ref_={ref} onFechar={() => setModal('')} onOk={recarregar} />}
          {modal === 'chamado' && <AbrirChamado e={e} onFechar={() => setModal('')} onOk={recarregar} />}
          {modal === 'baixa' && <SolicitarBaixa e={e} onFechar={() => setModal('')} onOk={recarregar} />}
          {modal === 'editar' && <EditarEquipamento e={e} onFechar={() => setModal('')} onOk={recarregar} />}
        </>
      );
    }}</Carregando>
  );
}

function ChamadosDoEquipamento({ id }: { id: string }) {
  const { navegar } = useApp();
  const r = useCarregar(() => api('GET', `/api/chamados?equipamento=${id}&situacao=todos`), [id]);
  return <div className="card"><Carregando {...r}>{() => <Tabela linhas={r.dados} onClick={l => navegar('/chamados/' + l.id)} vazio="Nenhum chamado" colunas={[
    { t: 'Nº', c: l => <strong>{l.numero}</strong> }, { t: 'Aberto em', c: l => dataHora(l.aberto_em) }, { t: 'Relato', c: l => l.relato },
    { t: 'Categoria', c: l => l.categoria_confirmada || l.categoria_relatada || '—', movel: false },
    { t: 'Situação', c: l => <><Pill mapa={SITUACAO_CHAMADO} valor={l.situacao} />{l.reincidente && <span className="pill p-vermelho" style={{ marginLeft: 4 }}>reincidente</span>}</> },
  ]} />}</Carregando></div>;
}

function CustosDoEquipamento({ id }: { id: string }) {
  const r = useCarregar(() => api('GET', `/api/custos?equipamento=${id}`), [id]);
  return <div className="card"><Carregando {...r}>{() => <>
    <Tabela linhas={r.dados} vazio="Nenhum custo lançado" colunas={[
      { t: 'Competência', c: l => String(l.competencia).slice(0, 7) }, { t: 'Tipo', c: l => TIPO_CUSTO[l.tipo] }, { t: 'Chamado', c: l => l.chamado_numero || '—' },
      { t: 'Fornecedor', c: l => l.fornecedor || '—', movel: false }, { t: 'Valor', num: true, c: l => <span style={{ color: l.valor < 0 ? 'var(--vermelho)' : undefined }}>{moeda(l.valor)}</span> },
    ]} />
    <div style={{ textAlign: 'right', marginTop: 10, fontWeight: 700 }}>Total: {moeda(r.dados.reduce((s: number, c: any) => s + Number(c.valor), 0))}</div>
  </>}</Carregando></div>;
}

// ======================= MODAIS =======================
/** Local de onde o equipamento sai no trânsito (sempre o local atual). */
const localAtual = (e: any) => (e.local_tipo === 'FORNECEDOR' ? e.local_fornecedor : e.local_loja) || e.loja;

/** Converte o destinatário escolhido ("F:<id>" fornecedor, "L:<id>" unidade) nos campos da movimentação. */
function destinoDe(ref_: any, valor: string) {
  if (!valor) return { destino_tipo: null, loja_destino_id: null, fornecedor_destino_id: null };
  const [tipo, id] = valor.split(':');
  if (tipo === 'F') return { destino_tipo: 'FORNECEDOR', loja_destino_id: null, fornecedor_destino_id: id };
  const unidade = ref_.lojas.find((l: any) => l.id === id);
  return { destino_tipo: unidade?.tipo === 'CD' ? 'CD' : 'LOJA', loja_destino_id: id, fornecedor_destino_id: null };
}

/** Destinatário do trânsito: fornecedor homologado ou outra unidade da rede. */
function Destinatario({ e, ref_, valor, onChange }: { e: any; ref_: any; valor: string; onChange: (v: any) => void }) {
  const fornecedores = ref_.fornecedores.filter((f: any) => f.homologado);
  const unidades = ref_.lojas.filter((l: any) => e.local_tipo === 'FORNECEDOR' || l.id !== e.local_loja_id);
  return (
    <select value={valor} onChange={onChange} required>
      <option value="">Selecione…</option>
      <optgroup label="Fornecedores">{fornecedores.map((f: any) => <option key={f.id} value={'F:' + f.id}>{f.razao_social}</option>)}</optgroup>
      <optgroup label="Unidades">{unidades.map((l: any) => <option key={l.id} value={'L:' + l.id}>{l.codigo} – {l.nome_fantasia}</option>)}</optgroup>
    </select>
  );
}

function Movimentar({ e, transicoes, ref_, onFechar, onOk }: { e: any; transicoes: any[]; ref_: any; onFechar: () => void; onOk: () => void }) {
  const { avisar, usuario } = useApp();
  const opcoes = usuario.perfil === 'GERENTE_LOJA' ? transicoes.filter(t => t.para === 'ATIVO') : transicoes;
  const { v, set } = useForm<any>({ para: opcoes.length === 1 ? opcoes[0].para : '', motivo: '', destinatario: '', documento: '', confirmou_receb: false, teste_ok: false });
  const acao = useAcao();
  const t = opcoes.find(x => x.para === v.para);

  const enviar = async () => {
    const payload = {
      id: uuid(), equipamento_id: e.id, status_novo: v.para, motivo: v.motivo || t?.descricao, chamado_id: e.chamado_aberto?.id ?? null,
      ...destinoDe(ref_, t?.exige_destino ? v.destinatario : ''), documento: v.documento || null,
      confirmou_receb: v.confirmou_receb, teste_ok: t?.exige_teste ? v.teste_ok : null,
    };
    const r = await acao.executar(() => acaoOffline('MOVIMENTAR', payload, `${e.descricao}: ${STATUS[e.status].rotulo} → ${STATUS[v.para].rotulo}`));
    if (r) { avisar(r.enfileirado ? 'Sem conexão: movimentação guardada na fila offline' : 'Movimentação registrada', r.enfileirado ? 'info' : 'ok'); onOk(); onFechar(); }
  };
  return (
    <Modal titulo="Movimentar equipamento" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={!v.para || (t?.exige_destino && !v.destinatario) || acao.enviando} onClick={enviar}>Registrar</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="campos">
        <Campo rotulo="Status atual"><input disabled value={STATUS[e.status].rotulo} /></Campo>
        <Campo rotulo="Novo status" obrigatorio>
          <select value={v.para} onChange={set('para')}><option value="">Selecione…</option>{opcoes.map(o => <option key={o.para} value={o.para}>{STATUS[o.para].rotulo} – {o.descricao}</option>)}</select>
        </Campo>
        {t?.exige_destino && <>
          <Campo rotulo="Sai de"><input disabled value={localAtual(e)} /></Campo>
          <Campo rotulo="Destinatário" obrigatorio><Destinatario e={e} ref_={ref_} valor={v.destinatario} onChange={set('destinatario')} /></Campo>
        </>}
        {t?.exige_documento_transporte && <Campo rotulo="Nota de remessa ou romaneio" obrigatorio><input value={v.documento} onChange={set('documento')} /></Campo>}
        <Campo rotulo="Motivo / observação" obrigatorio largo><textarea value={v.motivo} onChange={set('motivo')} placeholder={t?.descricao} /></Campo>
      </div>
      {(t?.exige_confirmacao_receb || t?.exige_teste) && <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {t.exige_confirmacao_receb && <label className="check"><input type="checkbox" checked={v.confirmou_receb} onChange={set('confirmou_receb')} /> Confirmo o recebimento físico do equipamento</label>}
        {t.exige_teste && <label className="check"><input type="checkbox" checked={v.teste_ok} onChange={set('teste_ok')} /> Teste de funcionamento realizado e aprovado</label>}
      </div>}
      {t?.exige_orcamento_ou_preventiva && <div className="aviso info" style={{ marginTop: 12 }}>Esta transição exige orçamento aprovado no chamado (ou ordem preventiva).</div>}
    </Modal>
  );
}

function AbrirChamado({ e, onFechar, onOk }: { e: any; onFechar: () => void; onOk: () => void }) {
  const { ref, avisar, pode, usuario } = useApp();
  const { v, set } = useForm<any>({ relato: '', categoria_falha_relatada_id: '', prioridade: 'MEDIA', tipo: 'CORRETIVA', resolvido_remoto: false,
                                    movimentacao: 'MANTER', destinatario: '', documento: '', motivo_mov: '' });
  const acao = useAcao();
  const [resultado, setResultado] = useState<any>(null);
  const categorias = useMemo(() => ref.categorias.filter((c: any) => !c.grupo_id || c.grupo_id === e.grupo_id || c.codigo === 'GEN-OUTROS'), [ref, e]);
  // Movimentação na abertura: vale para qualquer tipo de chamado, se a matriz permitir status -> Trânsito
  // (corretiva com equipamento ativo passa antes para Aguardando orçamento)
  const statusEfetivo = v.tipo === 'CORRETIVA' && !v.resolvido_remoto && e.status === 'ATIVO' ? 'AGUARDANDO_ORCAMENTO' : e.status;
  const matrizPermite = (ref.transicoes ?? []).some((t: any) => t.de === statusEfetivo && t.para === 'TRANSITO');
  const perfilMovimenta = pode('movimentar') && usuario.perfil !== 'GERENTE_LOJA';
  const podeMovimentar = perfilMovimenta && !v.resolvido_remoto && matrizPermite;
  const emTransito = podeMovimentar && v.movimentacao === 'TRANSITO';
  const faltaTransito = emTransito && (!v.destinatario || !v.documento.trim());
  const enviar = async () => {
    const { movimentacao, destinatario, documento, motivo_mov, ...dados } = v;
    const transito = emTransito ? { ...destinoDe(ref, destinatario), documento: documento.trim(), motivo: motivo_mov || null } : null;
    const r = await acao.executar(() => acaoOffline('ABRIR_CHAMADO', { equipamento_id: e.id, ...dados, categoria_falha_relatada_id: v.categoria_falha_relatada_id || null, transito },
      `Chamado: ${e.descricao} – ${v.relato.slice(0, 60)}${transito ? ' (envio em trânsito)' : ''}`));
    if (!r) return;
    if (r.enfileirado) { avisar('Sem conexão: chamado guardado na fila offline', 'info'); onOk(); onFechar(); return; }
    avisar(`Chamado nº ${r.resultado.numero} aberto` + (transito ? ' e equipamento enviado em trânsito' : '')); setResultado(r.resultado); onOk();
  };
  if (resultado) return (
    <Modal titulo={`Chamado nº ${resultado.numero} aberto`} onFechar={onFechar} rodape={<><Link para={'/chamados/' + resultado.id} className="btn">Ver chamado</Link><button className="btn primario" onClick={onFechar}>Fechar</button></>}>
      {resultado.aviso_garantia && <div className="aviso ok">{resultado.aviso_garantia}</div>}
      {resultado.reincidente && <div className="aviso erro" role="alert">Reincidência: falha da mesma categoria neste equipamento dentro da janela configurada.</div>}
      {resultado.modelo_em_alerta && <div className="aviso atencao">Este modelo está acima do limite de falhas nesta categoria (possível problema de lote/fabricante).</div>}
      <div className="muted small">Prioridade definida: <Pill mapa={PRIORIDADE} valor={resultado.prioridade} /></div>
      {resultado.historico_recente?.length > 0 && <><h3 style={{ marginTop: 14 }}>Chamados nos últimos 180 dias</h3>
        <Tabela linhas={resultado.historico_recente} chave="numero" colunas={[{ t: 'Nº', c: l => l.numero }, { t: 'Data', c: l => data(l.aberto_em) }, { t: 'Categoria', c: l => l.categoria || '—' }, { t: 'Situação', c: l => <Pill mapa={SITUACAO_CHAMADO} valor={l.situacao} /> }]} /></>}
    </Modal>
  );
  return (
    <Modal titulo="Abrir chamado" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={v.relato.length < 5 || faltaTransito || acao.enviando} onClick={enviar}>Abrir chamado</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {e.em_garantia && <div className="aviso ok">Equipamento em garantia até {data(e.garantia_fim)}: acione o fabricante antes de orçar com fornecedor local.</div>}
      <div className="campos">
        <Campo rotulo="Equipamento"><input disabled value={`${e.descricao} (${e.numero_serie})`} /></Campo>
        <Campo rotulo="Tipo"><select value={v.tipo} onChange={set('tipo')}><option value="CORRETIVA">Corretiva</option><option value="PREVENTIVA">Preventiva</option><option value="INSTALACAO">Instalação</option><option value="TROCA">Troca</option></select></Campo>
        <Campo rotulo="Categoria da falha"><Opcoes itens={categorias} valor={v.categoria_falha_relatada_id} onChange={set('categoria_falha_relatada_id')} rotulo={c => c.nome} vazio="Não sei / outra" /></Campo>
        <Campo rotulo="Prioridade"><select value={v.prioridade} onChange={set('prioridade')}>{Object.entries(PRIORIDADE).map(([k, p]) => <option key={k} value={k}>{p.rotulo}</option>)}</select></Campo>
        <Campo rotulo="Relato do problema" obrigatorio largo><textarea value={v.relato} onChange={set('relato')} placeholder="O que aconteceu, desde quando, o que já foi tentado" autoFocus /></Campo>
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={v.resolvido_remoto} onChange={set('resolvido_remoto')} /> Resolvido no diagnóstico remoto (registra o chamado e mantém o equipamento ativo)</label>
      {podeMovimentar && <>
        <h3 style={{ marginTop: 18 }}>Movimentação</h3>
        <div className="campos">
          <Campo rotulo="O que fazer com o equipamento" largo>
            <select value={v.movimentacao} onChange={set('movimentacao')}>
              <option value="MANTER">Manter no local</option>
              <option value="TRANSITO">Enviar em trânsito ao destinatário</option>
            </select>
          </Campo>
          {emTransito && <>
            <Campo rotulo="Sai de"><input disabled value={localAtual(e)} /></Campo>
            <Campo rotulo="Destinatário" obrigatorio><Destinatario e={e} ref_={ref} valor={v.destinatario} onChange={set('destinatario')} /></Campo>
            <Campo rotulo="Nota de remessa ou romaneio" obrigatorio><input value={v.documento} onChange={set('documento')} /></Campo>
            <Campo rotulo="Observação do envio"><input value={v.motivo_mov} onChange={set('motivo_mov')} placeholder="Envio para diagnóstico" /></Campo>
          </>}
        </div>
      </>}
      {!podeMovimentar && perfilMovimenta && !v.resolvido_remoto && <div className="aviso info" style={{ marginTop: 12 }}>
        Movimentação indisponível na abertura: equipamento com status {STATUS[e.status]?.rotulo ?? e.status} não pode ir para Trânsito.</div>}
    </Modal>
  );
}

function SolicitarBaixa({ e, onFechar, onOk }: { e: any; onFechar: () => void; onOk: () => void }) {
  const { avisar } = useApp();
  const descarte = e.status === 'BAIXADO';
  const { v, set } = useForm<any>({ motivo: '', certificado: '' });
  const acao = useAcao();
  const enviar = async () => {
    const r = await acao.executar(() => api('POST', `/api/equipamentos/${e.id}/baixa`, { tipo: descarte ? 'DESCARTE' : 'BAIXA', motivo: v.motivo, certificado: v.certificado || null }));
    if (r) { avisar('Solicitação enviada para aprovação de gestor'); onOk(); onFechar(); }
  };
  return (
    <Modal titulo={descarte ? 'Solicitar descarte' : 'Solicitar baixa'} onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn perigo" disabled={acao.enviando} onClick={enviar}>Enviar para aprovação</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="aviso atencao">A baixa exige aprovação de um gestor diferente de quem solicita. O histórico e o custo acumulado são preservados.</div>
      <Campo rotulo="Motivo e laudo" obrigatorio><textarea value={v.motivo} onChange={set('motivo')} /></Campo>
      {descarte && <div style={{ marginTop: 12 }}><Campo rotulo="Nº do certificado de destinação" obrigatorio><input value={v.certificado} onChange={set('certificado')} /></Campo></div>}
    </Modal>
  );
}

function EditarEquipamento({ e, onFechar, onOk }: { e: any; onFechar: () => void; onOk: () => void }) {
  const { ref, avisar } = useApp();
  const campos = ['descricao', 'cor', 'departamento_id', 'patrimonio', 'data_aquisicao', 'nota_fiscal', 'valor_aquisicao', 'garantia_inicio', 'garantia_fim', 'setor_instalacao', 'ponto_instalacao', 'responsavel_uso', 'ip', 'mac', 'hostname', 'firmware_versao'];
  const { v, set } = useForm<any>(Object.fromEntries(campos.map(c => [c, e[c] ?? ''])));
  const acao = useAcao();
  const salvar = async () => {
    const corpo = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
    if (await acao.executar(() => api('PUT', '/api/equipamentos/' + e.id, corpo))) { avisar('Dados atualizados'); onOk(); onFechar(); }
  };
  const texto = (c: string, r: string, tipo = 'text') => <Campo rotulo={r}><input type={tipo} value={v[c]} onChange={set(c)} /></Campo>;
  return (
    <Modal largo titulo="Editar equipamento" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="aviso info">Loja, status e localização mudam só por movimentação. Toda alteração fica no histórico com valor anterior e novo.</div>
      <div className="campos">
        {texto('descricao', 'Descrição')}{texto('cor', 'Cor')}
        <Campo rotulo="Departamento"><Opcoes itens={ref.departamentos} valor={v.departamento_id} onChange={set('departamento_id')} rotulo={d => d.nome} vazio={false} /></Campo>
        {texto('patrimonio', 'Patrimônio')}{texto('data_aquisicao', 'Aquisição', 'date')}{texto('nota_fiscal', 'Nota fiscal')}{texto('valor_aquisicao', 'Valor (R$)', 'number')}
        {texto('garantia_inicio', 'Início garantia', 'date')}{texto('garantia_fim', 'Fim garantia', 'date')}{texto('setor_instalacao', 'Setor')}{texto('ponto_instalacao', 'Ponto')}
        {texto('responsavel_uso', 'Responsável')}{texto('ip', 'IP')}{texto('mac', 'MAC')}{texto('hostname', 'Hostname')}{texto('firmware_versao', 'Firmware')}
      </div>
    </Modal>
  );
}
