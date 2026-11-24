// Agenda: calendário mensal; clicar no dia mostra os agendamentos daquela data e permite criar um novo.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Campo, Carregando, Link, Modal, Opcoes, Pill, useAcao, useApp, useCarregar, useForm } from '../ui';

export const TIPO_AGENDA: Record<string, { rotulo: string; cor: string }> = {
  VISITA_TECNICA: { rotulo: 'Visita técnica', cor: 'azul' },
  PREVENTIVA: { rotulo: 'Preventiva', cor: 'verde' },
  INSTALACAO: { rotulo: 'Instalação', cor: 'roxo' },
  COLETA_ENTREGA: { rotulo: 'Coleta/entrega', cor: 'ambar' },
  REUNIAO: { rotulo: 'Reunião', cor: 'cinza' },
  OUTRO: { rotulo: 'Outro', cor: 'cinza' },
};
const SITUACAO_AGENDA: Record<string, { rotulo: string; cor: string }> = {
  AGENDADO: { rotulo: 'Agendado', cor: 'azul' },
  CONCLUIDO: { rotulo: 'Concluído', cor: 'verde' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'cinza' },
};
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const pad = (n: number) => String(n).padStart(2, '0');
/** Data local em AAAA-MM-DD (sem converter para UTC). */
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dataLonga = (iso: string) => { const t = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const horario = (a: any) => a.hora_inicio ? a.hora_inicio + (a.hora_fim ? '–' + a.hora_fim : '') : 'Dia todo';

/** 42 dias (6 semanas, começando no domingo) que cobrem o mês. */
function diasDaGrade(ano: number, mes: number) {
  const inicio = new Date(ano, mes, 1);
  inicio.setDate(1 - inicio.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

export function Agenda() {
  const { ref, pode, usuario } = useApp();
  const hoje = isoLocal(new Date());
  const [mesRef, setMesRef] = useState(() => { const d = new Date(); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const [selecionado, setSelecionado] = useState(hoje);
  const [loja, setLoja] = useState('');
  const [resp, setResp] = useState('');
  const [modal, setModal] = useState<any>(null);   // {} = novo; registro = editar

  const dias = useMemo(() => diasDaGrade(mesRef.ano, mesRef.mes), [mesRef]);
  const de = isoLocal(dias[0]), ate = isoLocal(dias[41]);
  const r = useCarregar(() => api('GET', `/api/agenda?de=${de}&ate=${ate}`), [de, ate]);
  const responsaveis = useCarregar(() => api('GET', '/api/agenda/responsaveis'), []);

  const porDia = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const a of r.dados ?? []) {
      if (loja && a.loja_id !== loja) continue;
      if (resp === 'EU' ? a.responsavel_id !== usuario.id : resp && a.responsavel_id !== resp) continue;
      (m[a.data] ??= []).push(a);
    }
    return m;
  }, [r.dados, loja, resp, usuario.id]);

  const mudarMes = (delta: number) => setMesRef(({ ano, mes }) => { const d = new Date(ano, mes + delta, 1); return { ano: d.getFullYear(), mes: d.getMonth() }; });
  const irHoje = () => { const d = new Date(); setMesRef({ ano: d.getFullYear(), mes: d.getMonth() }); setSelecionado(hoje); };
  const escolher = (d: Date) => {
    setSelecionado(isoLocal(d));
    if (d.getMonth() !== mesRef.mes) setMesRef({ ano: d.getFullYear(), mes: d.getMonth() });
  };
  const doDia = porDia[selecionado] ?? [];
  const podeGerir = pode('agenda.gerir');

  return (
    <>
      <div className="topo">
        <div><div className="migalha">Cadastros</div><h1>Agenda</h1></div>
        <div className="acoes">
          {podeGerir && <button className="btn primario" onClick={() => setModal({ data: selecionado })}>Novo agendamento</button>}
        </div>
      </div>
      <div className="filtros">
        <Opcoes itens={ref.lojas} valor={loja} onChange={setLoja} vazio="Todas as lojas" rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} />
        <select aria-label="Responsável" value={resp} onChange={e => setResp(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          <option value="EU">Meus agendamentos</option>
          {(responsaveis.dados ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </div>

      <div className="agenda">
        <div className="card calendario">
          <div className="cal-topo">
            <button className="btn pequeno" onClick={() => mudarMes(-1)} aria-label="Mês anterior">‹</button>
            <h2>{MESES[mesRef.mes]} de {mesRef.ano}</h2>
            <button className="btn pequeno" onClick={() => mudarMes(1)} aria-label="Próximo mês">›</button>
            <button className="btn pequeno" onClick={irHoje}>Hoje</button>
          </div>
          {r.erro && <div className="aviso erro" role="alert">{r.erro}</div>}
          <div className="cal-grade" role="grid">
            {SEMANA.map(s => <div key={s} className="cal-semana">{s}</div>)}
            {dias.map(d => {
              const iso = isoLocal(d);
              const itens = (porDia[iso] ?? []).filter(a => a.situacao !== 'CANCELADO');
              const cls = ['cal-dia', d.getMonth() !== mesRef.mes && 'fora', iso === hoje && 'hoje', iso === selecionado && 'sel'].filter(Boolean).join(' ');
              return (
                <button key={iso} className={cls} onClick={() => escolher(d)} aria-pressed={iso === selecionado}
                        aria-label={`${d.getDate()} de ${MESES[d.getMonth()]}: ${itens.length} agendamento(s)`}>
                  <span className="cal-num">{d.getDate()}</span>
                  {itens.slice(0, 3).map(a => (
                    <span key={a.id} className={`cal-item p-${TIPO_AGENDA[a.tipo]?.cor ?? 'cinza'}${a.situacao === 'CONCLUIDO' ? ' feito' : ''}`}>
                      {a.hora_inicio && <b>{a.hora_inicio}</b>} {a.titulo}
                    </span>
                  ))}
                  {itens.length > 3 && <span className="cal-mais">+{itens.length - 3} mais</span>}
                  {itens.length > 0 && <span className="cal-pontos">{itens.slice(0, 4).map(a => <i key={a.id} className={`p-${TIPO_AGENDA[a.tipo]?.cor ?? 'cinza'}`} />)}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card dia-painel">
          <div className="card-topo">
            <h2>{dataLonga(selecionado)}</h2>
          </div>
          <Carregando {...r}>{() => <>
            {doDia.length === 0 && <div className="muted" style={{ padding: '8px 0 14px' }}>Nenhum agendamento nesta data.</div>}
            <ul className="lista-agenda">
              {doDia.map(a => (
                <li key={a.id} className={a.situacao === 'CANCELADO' ? 'cancelado' : ''}>
                  <button onClick={() => setModal(a)}>
                    <div className="la-hora">{horario(a)}</div>
                    <div className="la-corpo">
                      <strong>{a.titulo}</strong>
                      <div className="la-meta">
                        <Pill mapa={TIPO_AGENDA} valor={a.tipo} />
                        {a.situacao !== 'AGENDADO' && <Pill mapa={SITUACAO_AGENDA} valor={a.situacao} />}
                      </div>
                      <div className="muted small">
                        {[a.loja_codigo && `${a.loja_codigo} – ${a.loja_nome}`, a.responsavel && `Resp.: ${a.responsavel}`, a.fornecedor,
                          a.chamado_numero && `Chamado nº ${a.chamado_numero}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {podeGerir && <button className="btn primario" style={{ width: '100%' }} onClick={() => setModal({ data: selecionado })}>+ Novo agendamento</button>}
          </>}</Carregando>
        </div>
      </div>

      {modal && <FormAgendamento inicial={modal} responsaveis={responsaveis.dados ?? []} somenteLeitura={!podeGerir}
                                  onFechar={() => setModal(null)} onOk={(dataSalva) => { setModal(null); r.recarregar();
                                    const d = new Date(dataSalva + 'T12:00:00'); setSelecionado(dataSalva); setMesRef({ ano: d.getFullYear(), mes: d.getMonth() }); }} />}
    </>
  );
}

function FormAgendamento({ inicial, responsaveis, somenteLeitura, onFechar, onOk }: {
  inicial: any; responsaveis: any[]; somenteLeitura: boolean; onFechar: () => void; onOk: (data: string) => void;
}) {
  const { ref, avisar, usuario } = useApp();
  const novo = !inicial.id;
  const { v, set } = useForm<any>({
    titulo: inicial.titulo ?? '', tipo: inicial.tipo ?? 'VISITA_TECNICA', data: inicial.data,
    hora_inicio: inicial.hora_inicio ?? '', hora_fim: inicial.hora_fim ?? '', loja_id: inicial.loja_id ?? '',
    responsavel_id: inicial.responsavel_id ?? (responsaveis.some(p => p.id === usuario.id) ? usuario.id : ''),
    fornecedor_id: inicial.fornecedor_id ?? '', chamado_numero: inicial.chamado_numero ?? '', descricao: inicial.descricao ?? '',
    situacao: inicial.situacao ?? 'AGENDADO',
  });
  const acao = useAcao();
  const salvar = async (situacao = v.situacao) => {
    const corpo = { ...v, situacao };
    const ok = await acao.executar(() => novo ? api('POST', '/api/agenda', corpo) : api('PUT', '/api/agenda/' + inicial.id, corpo));
    if (ok) { avisar(novo ? 'Agendamento criado' : situacao !== inicial.situacao ? `Agendamento ${SITUACAO_AGENDA[situacao].rotulo.toLowerCase()}` : 'Agendamento salvo'); onOk(v.data); }
  };
  const invalido = v.titulo.trim().length < 3 || !v.data || (v.hora_inicio && v.hora_fim && v.hora_fim <= v.hora_inicio);
  const titulo = novo ? 'Novo agendamento' : somenteLeitura ? 'Agendamento' : 'Editar agendamento';

  return (
    <Modal titulo={titulo} onFechar={onFechar} rodape={somenteLeitura ? <button className="btn primario" onClick={onFechar}>Fechar</button> : <>
      {!novo && v.situacao === 'AGENDADO' && <>
        <button className="btn perigo" style={{ marginRight: 'auto' }} disabled={acao.enviando} onClick={() => salvar('CANCELADO')}>Cancelar agendamento</button>
        <button className="btn sucesso" disabled={acao.enviando || !!invalido} onClick={() => salvar('CONCLUIDO')}>Concluir</button>
      </>}
      {!novo && v.situacao !== 'AGENDADO' && <button className="btn" style={{ marginRight: 'auto' }} disabled={acao.enviando} onClick={() => salvar('AGENDADO')}>Reabrir</button>}
      <button className="btn" onClick={onFechar}>Fechar</button>
      <button className="btn primario" disabled={acao.enviando || !!invalido} onClick={() => salvar()}>Salvar</button>
    </>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {!novo && <div style={{ marginBottom: 10 }}><Pill mapa={SITUACAO_AGENDA} valor={v.situacao} /> <span className="muted small">criado por {inicial.criado_por}</span></div>}
      <fieldset disabled={somenteLeitura} className="campos" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Campo rotulo="Título" obrigatorio largo><input value={v.titulo} onChange={set('titulo')} autoFocus placeholder="Ex.: Visita para aferição das balanças" maxLength={120} /></Campo>
        <Campo rotulo="Tipo" obrigatorio>
          <select value={v.tipo} onChange={set('tipo')}>{Object.entries(TIPO_AGENDA).map(([k, t]) => <option key={k} value={k}>{t.rotulo}</option>)}</select>
        </Campo>
        <Campo rotulo="Data" obrigatorio><input type="date" value={v.data} onChange={set('data')} /></Campo>
        <Campo rotulo="Início"><input type="time" value={v.hora_inicio} onChange={set('hora_inicio')} /></Campo>
        <Campo rotulo="Fim"><input type="time" value={v.hora_fim} onChange={set('hora_fim')} /></Campo>
        <Campo rotulo="Loja"><Opcoes itens={ref.lojas} valor={v.loja_id} onChange={set('loja_id')} vazio="Toda a rede / não se aplica" rotulo={l => `${l.codigo} – ${l.nome_fantasia}`} /></Campo>
        <Campo rotulo="Responsável"><Opcoes itens={responsaveis} valor={v.responsavel_id} onChange={set('responsavel_id')} vazio="Não definido" rotulo={p => p.nome} /></Campo>
        <Campo rotulo="Fornecedor"><Opcoes itens={ref.fornecedores} valor={v.fornecedor_id} onChange={set('fornecedor_id')} vazio="Nenhum" rotulo={f => f.razao_social} /></Campo>
        <Campo rotulo="Chamado nº"><input type="number" min={1} value={v.chamado_numero} onChange={set('chamado_numero')} placeholder="Opcional" /></Campo>
        <Campo rotulo="Descrição / observações" largo><textarea value={v.descricao} onChange={set('descricao')} placeholder="Endereço, contato no local, o que levar…" /></Campo>
      </fieldset>
      {v.hora_inicio && v.hora_fim && v.hora_fim <= v.hora_inicio && <div className="aviso erro" style={{ marginTop: 10 }}>A hora final deve ser depois da inicial.</div>}
      {!novo && inicial.chamado_id && <div style={{ marginTop: 10 }}><Link para={'/chamados/' + inicial.chamado_id}>Abrir chamado nº {inicial.chamado_numero}</Link></div>}
    </Modal>
  );
}
