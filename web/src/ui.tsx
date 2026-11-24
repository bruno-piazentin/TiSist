// Componentes de interface, formatação e estado global do app.
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

// ---------------- formatação ----------------
const fMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fMoeda0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const moeda = (v: unknown, inteiro = false) => (v === null || v === undefined || v === '' ? '—' : (inteiro ? fMoeda0 : fMoeda).format(Number(v)));
export const num = (v: unknown, casas = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
export const data = (v: unknown) => {
  if (!v) return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}`; }
  return new Date(s).toLocaleDateString('pt-BR');
};
export const dataHora = (v: unknown) => (v ? new Date(String(v)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
/** CNPJ com pontuação (00.000.000/0000-00); outros valores ficam como estão. */
export const cnpjFmt = (v: unknown) => { const s = String(v ?? ''); return /^\d{14}$/.test(s) ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s; };
export const mesAno = (v: string) => { const [a, m] = v.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + a.slice(2); };

// ---------------- rótulos ----------------
export const STATUS: Record<string, { rotulo: string; cor: string }> = {
  ATIVO: { rotulo: 'Ativo', cor: 'verde' }, AGUARDANDO_ORCAMENTO: { rotulo: 'Aguardando orçamento', cor: 'ambar' },
  EM_MANUTENCAO: { rotulo: 'Em manutenção', cor: 'vermelho' }, TRANSITO: { rotulo: 'Trânsito', cor: 'azul' },
  EM_ESTOQUE: { rotulo: 'Em estoque', cor: 'cinza' }, EM_RESERVA: { rotulo: 'Em reserva', cor: 'roxo' },
  SINISTRADO: { rotulo: 'Sinistrado', cor: 'vermelho' }, BAIXADO: { rotulo: 'Baixado', cor: 'cinza' }, DESCARTADO: { rotulo: 'Descartado', cor: 'cinza' },
};
export const SITUACAO_CHAMADO: Record<string, { rotulo: string; cor: string }> = {
  ABERTO: { rotulo: 'Aberto', cor: 'ambar' }, EM_ORCAMENTO: { rotulo: 'Em orçamento', cor: 'ambar' }, EM_REPARO: { rotulo: 'Em reparo', cor: 'vermelho' },
  EM_RETORNO: { rotulo: 'Em retorno', cor: 'azul' }, ENCERRADO: { rotulo: 'Encerrado', cor: 'verde' }, CANCELADO: { rotulo: 'Cancelado', cor: 'cinza' },
};
export const STATUS_ORC: Record<string, { rotulo: string; cor: string }> = {
  RASCUNHO: { rotulo: 'Rascunho', cor: 'cinza' }, SOLICITADO: { rotulo: 'Solicitado', cor: 'cinza' }, RECEBIDO: { rotulo: 'Recebido', cor: 'ambar' },
  EM_ANALISE: { rotulo: 'Em análise', cor: 'ambar' }, APROVADO: { rotulo: 'Aprovado', cor: 'verde' }, REPROVADO: { rotulo: 'Reprovado', cor: 'vermelho' },
  EXPIRADO: { rotulo: 'Expirado', cor: 'cinza' }, SUBSTITUIDO: { rotulo: 'Substituído', cor: 'cinza' },
};
export const PRIORIDADE: Record<string, { rotulo: string; cor: string }> = {
  CRITICA: { rotulo: 'Crítica', cor: 'vermelho' }, ALTA: { rotulo: 'Alta', cor: 'ambar' }, MEDIA: { rotulo: 'Média', cor: 'azul' }, BAIXA: { rotulo: 'Baixa', cor: 'cinza' },
};
export const TIPO_CUSTO: Record<string, string> = { PECA: 'Peça', MAO_DE_OBRA: 'Mão de obra', FRETE: 'Frete', DESLOCAMENTO: 'Deslocamento', OUTROS: 'Outros' };
export const PERFIL: Record<string, string> = {
  ADMIN: 'Administrador', GESTOR_TI: 'Gestor de TI', COORDENADOR: 'Coordenador', TECNICO: 'Técnico de TI', GERENTE_LOJA: 'Gerente de loja',
  COMPRAS: 'Compras/Financeiro', AUDITORIA: 'Auditoria', DIRETORIA: 'Diretoria',
};

export function Pill({ mapa, valor }: { mapa: Record<string, { rotulo: string; cor: string }>; valor: string }) {
  const m = mapa[valor] || { rotulo: valor, cor: 'cinza' };
  return <span className={`pill p-${m.cor}`}>{m.rotulo}</span>;
}

// ---------------- estado global ----------------
export interface Usuario { id: string; nome: string; login: string; perfil: string; alcada_max: number; lojas: string[]; rede_toda: boolean; permissoes: string[]; parametro_grupos?: string[] }
export interface AppCtx {
  usuario: Usuario;
  ref: any;
  online: boolean;
  filaQtd: number;
  pode: (p: string) => boolean;
  navegar: (caminho: string) => void;
  avisar: (texto: string, tipo?: 'ok' | 'erro' | 'info') => void;
  recarregarRef: () => Promise<void>;
  sincronizarAgora: () => Promise<void>;
}
export const App = createContext<AppCtx>(null as any);
export const useApp = () => useContext(App);

// ---------------- roteamento simples (History API) ----------------
export function useRota() {
  const [caminho, setCaminho] = useState(location.pathname + location.search);
  useEffect(() => {
    const f = () => setCaminho(location.pathname + location.search);
    window.addEventListener('popstate', f);
    window.addEventListener('sisti:rota', f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('sisti:rota', f); };
  }, []);
  return caminho;
}
export function irPara(caminho: string) {
  if (caminho === location.pathname + location.search) return;
  history.pushState({ sisti: true }, '', caminho);   // marca navegação interna (usada pelo botão Voltar)
  window.dispatchEvent(new Event('sisti:rota'));
  window.scrollTo(0, 0);
}
/** Volta à tela anterior do app; se a página foi aberta direto (sem histórico interno), vai para `padrao`. */
export function Voltar({ padrao }: { padrao: string }) {
  const voltar = () => { if (history.state?.sisti) history.back(); else irPara(padrao); };
  return <button type="button" className="btn pequeno voltar" onClick={voltar} aria-label="Voltar à tela anterior">← Voltar</button>;
}
export function Link({ para, children, className, rotulo }: { para: string; children: ReactNode; className?: string; rotulo?: string }) {
  return <a href={para} className={className} data-rotulo={rotulo} aria-label={rotulo} onClick={e => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); irPara(para); }}>{children}</a>;
}

// ---------------- carregamento de dados ----------------
export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [estado, setEstado] = useState<{ dados?: T; erro?: string; carregando: boolean }>({ carregando: true });
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado(s => ({ ...s, carregando: true, erro: undefined }));
    fn().then(d => vivo && setEstado({ dados: d, carregando: false }))
        .catch(e => vivo && setEstado({ erro: e.message || String(e), carregando: false }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, versao]);
  const recarregar = useCallback(() => setVersao(v => v + 1), []);
  return { ...estado, recarregar };
}

// Mantém o conteúdo anterior durante recargas (evita piscar e preserva modais abertos)
export function Carregando({ erro, carregando, dados, children }: { erro?: string; carregando: boolean; dados?: unknown; children: () => ReactNode }) {
  if (erro) return <div className="aviso erro" role="alert">{erro}</div>;
  if (carregando && dados === undefined) return <div className="muted" style={{ padding: 20 }}>Carregando…</div>;
  return <>{children()}</>;
}

// ---------------- modal e formulário ----------------
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focaveisEm = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(x => x.offsetParent !== null);

export function Modal({ titulo, onFechar, children, rodape, largo }: { titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largo?: boolean }) {
  const caixa = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  // Ao abrir: foco no primeiro campo (no celular, na própria janela, para não abrir o teclado); ao fechar: volta ao botão de origem
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const el = caixa.current!;
    const toque = window.matchMedia?.('(pointer: coarse)').matches;
    const campo = toque ? null : el.querySelector<HTMLElement>('.modal-corpo :is(input, select, textarea):not([disabled]):not([type=hidden])');
    (campo || el).focus({ preventScroll: true });
    return () => { if (anterior && document.contains(anterior)) anterior.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const el = caixa.current;
      // com janelas empilhadas, só a de cima responde
      if (!el || el.closest('.modal-fundo')?.nextElementSibling?.classList.contains('modal-fundo')) return;
      if (e.key === 'Escape') { onFechar(); return; }
      if (e.key !== 'Tab') return;
      const lista = focaveisEm(el);
      if (!lista.length) { e.preventDefault(); return; }
      const primeiro = lista[0], ultimo = lista[lista.length - 1];
      const dentro = el.contains(document.activeElement);
      if (e.shiftKey && (!dentro || document.activeElement === primeiro || document.activeElement === el)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (!dentro || document.activeElement === ultimo)) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onFechar]);
  return (
    <div className="modal-fundo" onMouseDown={e => e.target === e.currentTarget && onFechar()}>
      <div ref={caixa} className={'modal' + (largo ? ' largo' : '')} role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1}>
        <div className="modal-topo"><h2 id={tituloId}>{titulo}</h2><button type="button" className="fechar" onClick={onFechar} aria-label="Fechar janela">×</button></div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

export function Campo({ rotulo, obrigatorio, largo, children }: { rotulo: string; obrigatorio?: boolean; largo?: boolean; children: ReactNode }) {
  const id = useId();
  // Campo simples (input, select, textarea ou lista de opções): o rótulo aponta para ele.
  // Conteúdo composto (caixas de seleção etc.): o rótulo nomeia o grupo.
  const ligavel = isValidElement(children) && (['input', 'select', 'textarea'].includes(children.type as string) || children.type === Opcoes);
  const filho = children as ReactElement<{ id?: string }>;
  const campoId = ligavel ? (filho.props.id ?? id) : undefined;
  return (
    <div className={'campo' + (largo ? ' largo' : '')} role={ligavel ? undefined : 'group'} aria-labelledby={ligavel ? undefined : id + '-r'}>
      <label id={id + '-r'} htmlFor={campoId}>{rotulo}{obrigatorio && <span className="obr" aria-hidden="true"> *</span>}{obrigatorio && <span className="sr-only"> (obrigatório)</span>}</label>
      {ligavel ? cloneElement(filho, { id: campoId }) : children}
    </div>
  );
}

export function Opcoes({ itens, valor, onChange, vazio = 'Selecione…', rotulo, obrigatorio, disabled, id, nome }: {
  itens: any[]; valor: string; onChange: (v: string) => void; vazio?: string | false; rotulo: (i: any) => string; obrigatorio?: boolean; disabled?: boolean;
  id?: string; nome?: string;   // nome: rótulo para leitor de tela quando não há <Campo> (filtros)
}) {
  // Fora de um <Campo> (filtro), o texto da opção vazia ("Todas as lojas") serve de nome
  const nomeAcessivel = id ? undefined : nome ?? (typeof vazio === 'string' && vazio !== 'Selecione…' ? vazio : undefined);
  return (
    <select id={id} aria-label={nomeAcessivel} value={valor ?? ''} onChange={e => onChange(e.target.value)} required={obrigatorio} disabled={disabled}>
      {vazio !== false && <option value="">{vazio}</option>}
      {itens.map(i => <option key={i.id ?? i.valor} value={i.id ?? i.valor}>{rotulo(i)}</option>)}
    </select>
  );
}

/** Estado de formulário com setter por campo. */
export function useForm<T extends Record<string, any>>(inicial: T) {
  const [v, setV] = useState<T>(inicial);
  const set = (campo: keyof T) => (e: any) => {
    const valor = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setV(s => ({ ...s, [campo]: valor }));
  };
  return { v, set, setV };
}

/** Botão que executa ação assíncrona com estado de envio e erro. */
export function useAcao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const executar = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setEnviando(true); setErro(null);
    try { return await fn(); }
    catch (e: any) { setErro(e.message || String(e)); return undefined; }
    finally { setEnviando(false); }
  };
  return { enviando, erro, setErro, executar };
}

export function Kpi({ rotulo, valor, sub, alerta }: { rotulo: string; valor: ReactNode; sub?: ReactNode; alerta?: boolean }) {
  return <div className={'card kpi' + (alerta ? ' alerta' : '')}><div className="rotulo">{rotulo}</div><div className="valor">{valor}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

export function Tabela({ colunas, linhas, onClick, vazio = 'Nenhum registro', chave = 'id' }: {
  colunas: { t: string; c: (l: any) => ReactNode; num?: boolean; movel?: boolean }[]; linhas: any[]; onClick?: (l: any) => void; vazio?: string; chave?: string;
}) {
  return (
    <div className="tabela-wrap">
      <table>
        <thead><tr>{colunas.map(c => <th key={c.t} className={(c.num ? 'num ' : '') + (c.movel === false ? 'esconder-movel' : '')}>{c.t}</th>)}</tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={colunas.length} className="vazio">{vazio}</td></tr>}
          {linhas.map((l, i) => (
            <tr key={l[chave] ?? i} className={onClick ? 'clicavel' : ''} onClick={onClick ? () => onClick(l) : undefined}
              tabIndex={onClick ? 0 : undefined}
              onKeyDown={onClick ? e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick(l); } } : undefined}>
              {colunas.map(c => <td key={c.t} className={(c.num ? 'num ' : '') + (c.movel === false ? 'esconder-movel' : '')}>{c.c(l)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
