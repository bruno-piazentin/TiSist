// PDVs: painel de checkouts por loja (cartões com periféricos e comunicação), detalhe e cadastro.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Ic } from '../icones';
import { Campo, Carregando, Link, Modal, Opcoes, STATUS, dataHora, useAcao, useApp, useCarregar } from '../ui';

// Posições de equipamento no PDV, na ordem de exibição. `sugere` destaca os equipamentos mais prováveis na lista.
const POSICOES = [
  { campo: 'computador_id', rotulo: 'Computador', icone: Ic.computador, sugere: /pdv|cpu|computador|desktop|micro/i },
  { campo: 'impressora_id', rotulo: 'Impressora', icone: Ic.impressora, sugere: /impress/i },
  { campo: 'scanner_id', rotulo: 'Scanner', icone: Ic.scanner, sugere: /leitor|scanner/i },
  { campo: 'teclado_id', rotulo: 'Teclado', icone: Ic.teclado, sugere: /teclado/i },
  { campo: 'gaveta_id', rotulo: 'Gaveta', icone: Ic.gaveta, sugere: /gaveta/i },
  { campo: 'balanca_id', rotulo: 'Balança', icone: Ic.balanca, sugere: /balan/i },
] as const;

const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  ATIVO: { rotulo: 'Ativo', cor: 'verde' }, PARADO: { rotulo: 'Parado', cor: 'ambar' }, INATIVO: { rotulo: 'Inativo', cor: 'cinza' },
};

/** "há 5 min", "há 2 h", "há 3 dias" */
function ha(v?: string | null) {
  if (!v) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}

/** Estado de comunicação de um PDV, combinando o teste do SisTI e o Zabbix. */
function comunicacao(p: any): { tipo: 'ok' | 'falha' | 'pendente' | 'nao'; texto: string; detalhe?: string } {
  if (!p.ativo) return { tipo: 'nao', texto: 'Não monitorado (inativo)' };
  if (!p.ip) return { tipo: 'nao', texto: 'Sem IP cadastrado' };
  if (p.online === false || p.zabbix_disponivel === false) {
    const desde = p.offline_desde || p.ultima_resposta;
    return { tipo: 'falha', texto: 'Sem comunicação' + (desde ? ' ' + ha(desde) : ''),
             detalhe: p.online === false ? (p.ultima_resposta ? `Última resposta: ${dataHora(p.ultima_resposta)}` : 'Nunca respondeu') : 'Indisponível no Zabbix' };
  }
  if (p.online) return { tipo: 'ok', texto: 'Online' + (p.latencia_ms != null ? ` · ${p.latencia_ms} ms` : '') };
  return { tipo: 'pendente', texto: 'Aguardando primeiro teste' };
}

const alertasZabbix = (p: any): any[] => (Array.isArray(p.zabbix_problemas) ? p.zabbix_problemas : []);

export function Pdvs() {
  const { ref, pode } = useApp();
  const [loja, setLoja] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'ok' | 'parado' | 'falha' | 'inativo'>('todos');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<any>(null);
  const [editar, setEditar] = useState<any>(null);
  const r = useCarregar(() => api('GET', '/api/pdvs' + (loja ? '?loja=' + loja : '')), [loja]);

  // A comunicação muda sozinha: atualiza a lista a cada 30 s enquanto a tela está aberta e visível
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') r.recarregar(); }, 30_000);
    return () => clearInterval(t);
  }, [loja]);

  const todos: any[] = r.dados || [];
  const conta = useMemo(() => ({
    total: todos.length,
    ok: todos.filter(p => p.situacao === 'ATIVO' && comunicacao(p).tipo !== 'falha').length,
    parado: todos.filter(p => p.situacao === 'PARADO').length,
    falha: todos.filter(p => comunicacao(p).tipo === 'falha').length,
    inativo: todos.filter(p => p.situacao === 'INATIVO').length,
  }), [todos]);

  const termo = busca.trim().toLowerCase();
  const visiveis = todos.filter(p => {
    const c = comunicacao(p).tipo;
    if (filtro === 'ok' && !(p.situacao === 'ATIVO' && c !== 'falha')) return false;
    if (filtro === 'parado' && p.situacao !== 'PARADO') return false;
    if (filtro === 'falha' && c !== 'falha') return false;
    if (filtro === 'inativo' && p.situacao !== 'INATIVO') return false;
    if (!termo) return true;
    const perif = Object.values(p.perifericos || {}).map((e: any) => `${e.descricao} ${e.modelo} ${e.numero_serie} ${e.patrimonio || ''}`).join(' ');
    return `pdv ${p.numero} ${p.ip || ''} ${p.loja_codigo} ${p.loja} ${perif}`.toLowerCase().includes(termo);
  });
  const porLoja = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of visiveis) m.set(p.loja_id, [...(m.get(p.loja_id) || []), p]);
    return [...m.values()];
  }, [visiveis]);

  const resumo: { chave: typeof filtro; rotulo: string; valor: number; cor: string }[] = [
    { chave: 'todos', rotulo: 'PDVs', valor: conta.total, cor: 'neutro' },
    { chave: 'ok', rotulo: 'Operando', valor: conta.ok, cor: 'verde' },
    { chave: 'parado', rotulo: 'Parados', valor: conta.parado, cor: 'ambar' },
    { chave: 'falha', rotulo: 'Sem comunicação', valor: conta.falha, cor: 'vermelho' },
    { chave: 'inativo', rotulo: 'Inativos', valor: conta.inativo, cor: 'cinza' },
  ];

  return (
    <>
      <div className="topo">
        <div><div className="migalha">Operação</div><h1>PDVs</h1></div>
        <div className="acoes">
          {pode('equipamento.gerir') && <button className="btn primario" onClick={() => setEditar({ loja_id: loja })}><Ic.mais tamanho={18} />Incluir PDV</button>}
        </div>
      </div>

      <div className="pdv-resumo" role="group" aria-label="Filtrar PDVs por situação">
        {resumo.map(s => (
          <button key={s.chave} className={`pdv-resumo-item c-${s.cor}` + (filtro === s.chave ? ' ativo' : '')}
            aria-pressed={filtro === s.chave} onClick={() => setFiltro(filtro === s.chave && s.chave !== 'todos' ? 'todos' : s.chave)}>
            <span className="valor">{s.valor}</span><span className="rotulo">{s.rotulo}</span>
          </button>
        ))}
      </div>

      <div className="filtros">
        <Opcoes itens={ref.lojas} valor={loja} onChange={setLoja} vazio="Todas as lojas" rotulo={l => `${l.codigo} · ${l.nome_fantasia}`} />
        <input type="search" placeholder="Buscar PDV, IP, modelo ou série…" aria-label="Buscar PDV" value={busca} onChange={e => setBusca(e.target.value)} />
      </div>

      <Carregando {...r}>{() => (
        porLoja.length === 0
          ? <div className="card vazio-grande">
              <Ic.pdv tamanho={40} />
              <p>{todos.length ? 'Nenhum PDV com esse filtro.' : 'Nenhum PDV cadastrado ainda.'}</p>
              {!todos.length && pode('equipamento.gerir') && <button className="btn primario" onClick={() => setEditar({ loja_id: loja })}>Incluir o primeiro PDV</button>}
            </div>
          : porLoja.map(lista => <GrupoLoja key={lista[0].loja_id} lista={lista} onAbrir={setAberto} />)
      )}</Carregando>

      {aberto && <DetalhePdv pdv={aberto} onFechar={() => setAberto(null)} onEditar={() => { setEditar(aberto); setAberto(null); }} onAtualizado={r.recarregar} />}
      {editar && <FormPdv pdv={editar} onFechar={() => setEditar(null)} onOk={r.recarregar} />}
    </>
  );
}

function GrupoLoja({ lista, onAbrir }: { lista: any[]; onAbrir: (p: any) => void }) {
  const falhas = lista.filter(p => comunicacao(p).tipo === 'falha').length;
  const parados = lista.filter(p => p.situacao === 'PARADO').length;
  return (
    <section className="pdv-loja" aria-label={`Loja ${lista[0].loja_codigo}`}>
      <header>
        <h2><span className="mono">{lista[0].loja_codigo}</span> {lista[0].loja}</h2>
        <span className="muted small">
          {lista.length} PDV{lista.length > 1 ? 's' : ''}
          {parados > 0 && <> · <span className="txt-ambar">{parados} parado{parados > 1 ? 's' : ''}</span></>}
          {falhas > 0 && <> · <span className="txt-vermelho">{falhas} sem comunicação</span></>}
        </span>
      </header>
      <div className="pdv-grade">{lista.map(p => <CartaoPdv key={p.id} p={p} onAbrir={() => onAbrir(p)} />)}</div>
    </section>
  );
}

function CartaoPdv({ p, onAbrir }: { p: any; onAbrir: () => void }) {
  const c = comunicacao(p);
  const alertas = alertasZabbix(p);
  const estado = p.situacao === 'INATIVO' ? 'inativo' : c.tipo === 'falha' ? 'falha' : p.situacao === 'PARADO' ? 'parado' : 'ok';
  return (
    <button className={'pdv-cartao e-' + estado} onClick={onAbrir}
      aria-label={`PDV ${p.numero}, ${SITUACAO[p.situacao].rotulo}, ${c.texto}. Abrir detalhes`}>
      <div className="pdv-cab">
        <div className="pdv-num"><small>PDV</small>{String(p.numero).padStart(2, '0')}</div>
        <span className={'pill p-' + SITUACAO[p.situacao].cor}>{SITUACAO[p.situacao].rotulo}</span>
      </div>
      <div className={'pdv-com c-' + c.tipo}>
        <span className="pdv-luz" aria-hidden="true" />
        {c.tipo === 'falha' ? <Ic.semSinal tamanho={15} /> : <Ic.sinal tamanho={15} />}
        <span>{c.texto}</span>
      </div>
      <div className="pdv-ip mono">{p.ip || '—'}</div>
      <div className="pdv-perif" aria-hidden="true">
        {POSICOES.map(pos => {
          const e = p.perifericos?.[pos.campo];
          const st = !e ? 'vazio' : e.status === 'ATIVO' ? 'ok' : 'fora';
          return (
            <span key={pos.campo} className={'pdv-slot s-' + st}
              title={`${pos.rotulo}: ${e ? `${e.modelo || e.descricao} · ${STATUS[e.status]?.rotulo || e.status}` : 'não vinculado'}`}>
              <pos.icone tamanho={17} />
            </span>
          );
        })}
      </div>
      {alertas.length > 0 && <div className="pdv-zbx"><Ic.alerta tamanho={14} />{alertas.length} alerta{alertas.length > 1 ? 's' : ''} no Zabbix</div>}
    </button>
  );
}

function DetalhePdv({ pdv, onFechar, onEditar, onAtualizado }: { pdv: any; onFechar: () => void; onEditar: () => void; onAtualizado: () => void }) {
  const { pode, avisar } = useApp();
  const [p, setP] = useState(pdv);
  const acao = useAcao();
  const c = comunicacao(p);
  const alertas = alertasZabbix(p);
  const testar = async () => {
    const novo = await acao.executar(() => api('POST', `/api/pdvs/${p.id}/verificar`));
    if (novo) { setP(novo); onAtualizado(); avisar(novo.online ? 'PDV respondeu' : 'PDV não respondeu'); }
  };
  const parados = POSICOES.filter(pos => p.perifericos?.[pos.campo] && p.perifericos[pos.campo].status !== 'ATIVO');
  return (
    <Modal largo titulo={`PDV ${String(p.numero).padStart(2, '0')} · ${p.loja_codigo} ${p.loja}`} onFechar={onFechar}
      rodape={<>
        <button className="btn" onClick={onFechar}>Fechar</button>
        {pode('equipamento.gerir') && <button className="btn primario" onClick={onEditar}>Editar PDV</button>}
      </>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {p.situacao === 'PARADO' && (
        <div className="aviso atencao">
          <strong>PDV parado:</strong> {parados.map(pos => `${pos.rotulo.toLowerCase()} ${STATUS[p.perifericos[pos.campo].status]?.rotulo.toLowerCase()}`).join(', ')}.
          Volta a Ativo sozinho quando o equipamento retornar (ou troque o periférico em "Editar PDV").
        </div>
      )}

      <div className="pdv-det">
        <div className={'pdv-det-com c-' + c.tipo}>
          <div className="pdv-det-com-ic">{c.tipo === 'falha' ? <Ic.semSinal tamanho={26} /> : <Ic.sinal tamanho={26} />}</div>
          <div>
            <div className="pdv-det-com-tit">{c.texto}</div>
            <div className="muted small">
              IP <span className="mono">{p.ip || '—'}</span>
              {p.verificado_em && <> · testado {ha(p.verificado_em)}</>}
              {c.detalhe && <> · {c.detalhe}</>}
            </div>
          </div>
          {p.ip && p.ativo && (
            <button className="btn" onClick={testar} disabled={acao.enviando}>
              <Ic.atualizar tamanho={16} />{acao.enviando ? 'Testando…' : 'Testar agora'}
            </button>
          )}
        </div>
        <dl className="pdv-det-dados">
          <div><dt>Situação</dt><dd><span className={'pill p-' + SITUACAO[p.situacao].cor}>{SITUACAO[p.situacao].rotulo}</span></dd></div>
          <div><dt>Zabbix</dt><dd>{p.zabbix_verificado_em
            ? (p.zabbix_disponivel === false ? <span className="txt-vermelho">Indisponível</span>
               : p.zabbix_disponivel ? 'Disponível' : 'Host sem dado de disponibilidade')
            : <span className="muted">não encontrado / não configurado</span>}</dd></div>
          <div><dt>Atualizado</dt><dd>{dataHora(p.atualizado_em)}</dd></div>
        </dl>
      </div>

      {alertas.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>Alertas ativos no Zabbix</h3>
          <ul className="pdv-alertas">
            {alertas.map((a, i) => (
              <li key={i} className={'nivel-' + a.nivel}><Ic.alerta tamanho={15} /><span>{a.nome}</span><span className="muted small">{a.severidade} · {ha(a.desde)}</span></li>
            ))}
          </ul>
        </>
      )}

      <h3 style={{ marginTop: 18 }}>Equipamentos do PDV</h3>
      <ul className="pdv-lista-perif">
        {POSICOES.map(pos => {
          const e = p.perifericos?.[pos.campo];
          return (
            <li key={pos.campo} className={!e ? 's-vazio' : e.status === 'ATIVO' ? 's-ok' : 's-fora'}>
              <span className="pdv-slot"><pos.icone tamanho={18} /></span>
              <div className="pdv-lista-txt">
                <div className="muted small">{pos.rotulo}</div>
                {e ? <Link para={'/equipamentos/' + e.id}>{e.modelo || e.descricao}</Link> : <span className="muted">Não vinculado</span>}
                {e && <div className="muted small">{e.marca} · série <span className="mono">{e.numero_serie}</span>{e.patrimonio && <> · pat. <span className="mono">{e.patrimonio}</span></>}</div>}
              </div>
              {e && <span className={'pill p-' + (STATUS[e.status]?.cor || 'cinza')}>{STATUS[e.status]?.rotulo || e.status}</span>}
            </li>
          );
        })}
      </ul>
      {p.observacao && <><h3 style={{ marginTop: 18 }}>Observação</h3><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.observacao}</p></>}
    </Modal>
  );
}

function FormPdv({ pdv, onFechar, onOk }: { pdv: any; onFechar: () => void; onOk: () => void }) {
  const { ref, avisar } = useApp();
  const [v, setV] = useState<any>(() => ({
    loja_id: pdv.loja_id || '', numero: pdv.numero ?? '', ip: pdv.ip || '', ativo: pdv.ativo ?? true, observacao: pdv.observacao || '',
    ...Object.fromEntries(POSICOES.map(pos => [pos.campo, pdv[pos.campo] || ''])),
  }));
  const acao = useAcao();
  const equip = useCarregar(
    () => (v.loja_id ? api('GET', `/api/pdvs/equipamentos?loja=${v.loja_id}` + (pdv.id ? `&pdv=${pdv.id}` : '')) : Promise.resolve([])),
    [v.loja_id]);
  const trocarLoja = (loja_id: string) =>
    setV((s: any) => ({ ...s, loja_id, ...Object.fromEntries(POSICOES.map(pos => [pos.campo, ''])) }));   // equipamentos são por loja

  // Ao escolher o computador, sugere o IP dele se o PDV ainda não tem
  const escolher = (campo: string, id: string) => setV((s: any) => {
    const e = (equip.dados || []).find((x: any) => x.id === id);
    return { ...s, [campo]: id, ...(campo === 'computador_id' && e?.ip && !s.ip ? { ip: e.ip } : {}) };
  });

  const salvar = async () => {
    const corpo = { ...v, numero: Number(v.numero), ip: v.ip.trim() || null, observacao: v.observacao || null,
                    ...Object.fromEntries(POSICOES.map(pos => [pos.campo, v[pos.campo] || null])) };
    if (await acao.executar(() => pdv.id ? api('PUT', '/api/pdvs/' + pdv.id, corpo) : api('POST', '/api/pdvs', corpo))) {
      avisar(pdv.id ? 'PDV atualizado' : 'PDV incluído'); onOk(); onFechar();
    }
  };

  // Outros campos já escolhidos não aparecem de novo nas listas
  const escolhidos = new Set(POSICOES.map(pos => v[pos.campo]).filter(Boolean));
  const opcoes = (pos: typeof POSICOES[number]): any[] => {
    const lista = (equip.dados || []).filter((e: any) => e.id === v[pos.campo] || !escolhidos.has(e.id));
    const casa = (e: any) => pos.sugere.test(`${e.produto} ${e.descricao} ${e.grupo}`);
    return [...lista.filter(casa), ...lista.filter((e: any) => !casa(e))];
  };
  const rotuloEquip = (e: any) =>
    `${e.modelo || e.descricao} · ${e.patrimonio ? 'pat. ' + e.patrimonio : 'série ' + e.numero_serie}${e.status !== 'ATIVO' ? ` (${STATUS[e.status]?.rotulo || e.status})` : ''}`;

  return (
    <Modal largo titulo={pdv.id ? `Editar PDV ${pdv.numero}` : 'Incluir PDV'} onFechar={onFechar}
      rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>{acao.enviando ? 'Salvando…' : 'Salvar'}</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="campos">
        <Campo rotulo="Loja" obrigatorio><Opcoes itens={ref.lojas} valor={v.loja_id} onChange={trocarLoja} rotulo={l => `${l.codigo} · ${l.nome_fantasia}`} /></Campo>
        <Campo rotulo="Número do PDV" obrigatorio><input type="number" min="1" max="999" inputMode="numeric" value={v.numero} onChange={e => setV({ ...v, numero: e.target.value })} /></Campo>
        <Campo rotulo="IP"><input value={v.ip} onChange={e => setV({ ...v, ip: e.target.value })} placeholder="ex.: 10.10.5.21" inputMode="decimal" className="mono" /></Campo>
        <Campo rotulo="Status">
          <div className="segmentado">
            <label className={v.ativo ? 'ativo' : ''}><input type="radio" name="pdv-ativo" checked={v.ativo} onChange={() => setV({ ...v, ativo: true })} />Ativo</label>
            <label className={!v.ativo ? 'ativo' : ''}><input type="radio" name="pdv-ativo" checked={!v.ativo} onChange={() => setV({ ...v, ativo: false })} />Inativo</label>
          </div>
        </Campo>
      </div>
      <p className="muted small" style={{ margin: '4px 0 14px' }}>
        <strong>Parado</strong> é automático: o PDV fica parado quando algum equipamento vinculado é movimentado
        (manutenção, trânsito, aguardando orçamento) e volta a ativo quando ele retorna.
      </p>

      <h3>Equipamentos do PDV</h3>
      {!v.loja_id
        ? <p className="muted">Escolha a loja para listar os equipamentos dela.</p>
        : <Carregando {...equip}>{() => (
            <div className="campos">
              {POSICOES.map(pos => (
                <Campo key={pos.campo} rotulo={pos.rotulo}>
                  <Opcoes itens={opcoes(pos)} valor={v[pos.campo]} onChange={id => escolher(pos.campo, id)} vazio="Nenhum" rotulo={rotuloEquip} />
                </Campo>
              ))}
            </div>
          )}</Carregando>}
      {v.loja_id && equip.dados && equip.dados.length === 0 &&
        <p className="muted small">Esta loja não tem equipamentos disponíveis. Cadastre-os em <Link para="/equipamentos/novo">Equipamentos</Link>.</p>}

      <div className="campos" style={{ marginTop: 6 }}>
        <Campo rotulo="Observação" largo><textarea rows={2} value={v.observacao} onChange={e => setV({ ...v, observacao: e.target.value })} /></Campo>
      </div>
    </Modal>
  );
}

