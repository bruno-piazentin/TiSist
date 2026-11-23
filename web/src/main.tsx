// Ponto de entrada do front-end: login, layout, rotas e ciclo de sincronização offline.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getComCache, sessao, sincronizar } from './api';
import { aoMudarFila, cache, fila } from './offline';
import { App, Link, PERFIL, irPara, useRota, type AppCtx, type Usuario } from './ui';
import { Dashboard } from './pages/Dashboard';
import { Equipamentos, EquipamentoDetalhe, EquipamentoNovo } from './pages/Equipamentos';
import { Chamados, ChamadoDetalhe } from './pages/Chamados';
import { Aprovacoes } from './pages/Aprovacoes';
import { Custos } from './pages/Custos';
import { Cadastros, Usuarios, Parametros } from './pages/Cadastros';
import { Fila } from './pages/Fila';
import { Agenda } from './pages/Agenda';
import { Ic, type Icone as IconeT } from './icones';

function Login({ onEntrar }: { onEntrar: (u: Usuario) => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(''); setEnviando(true);
    try {
      const r = await api('POST', '/api/auth/login', { login, senha });
      sessao.definir(r.token);
      await cache.set('usuario', r.usuario);
      onEntrar(r.usuario);
    } catch (er: any) { setErro(er.message); } finally { setEnviando(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={entrar}>
        <div className="marca"><img src="/icon.svg" alt="" /><div><h1>SisTI</h1><div className="muted small">Manutenção de equipamentos de TI</div></div></div>
        {erro && <div className="aviso erro">{erro}</div>}
        <div className="campo" style={{ marginBottom: 12 }}><label>Login</label><input value={login} onChange={e => setLogin(e.target.value)} autoFocus autoComplete="username" required /></div>
        <div className="campo" style={{ marginBottom: 18 }}><label>Senha</label><input type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="current-password" required /></div>
        <button className="btn primario" style={{ width: '100%', justifyContent: 'center' }} disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function rota(caminho: string) {
  const [p] = caminho.split('?');
  const partes = p.split('/').filter(Boolean);
  if (!partes.length) return <Dashboard />;
  switch (partes[0]) {
    case 'equipamentos':
      if (partes[1] === 'novo') return <EquipamentoNovo />;
      return partes[1] ? <EquipamentoDetalhe id={partes[1]} key={partes[1]} /> : <Equipamentos />;
    case 'chamados': return partes[1] ? <ChamadoDetalhe id={partes[1]} key={partes[1]} /> : <Chamados />;
    case 'aprovacoes': return <Aprovacoes />;
    case 'custos': return <Custos />;
    case 'cadastros': return <Cadastros entidade={partes[1] || 'lojas'} key={partes[1]} />;
    case 'usuarios': return <Usuarios />;
    case 'parametros': return <Parametros />;
    case 'fila': return <Fila />;
    case 'agenda': return <Agenda />;
  }
  return <div className="card">Página não encontrada. <Link para="/">Voltar ao início</Link></div>;
}

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

/** Painel do usuário no canto superior direito: nome, perfil, conexão e Sair. */
function MenuUsuario({ usuario, online, filaQtd, onSair }: { usuario: Usuario; online: boolean; filaQtd: number; onSair: () => void }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  const ir = (p: string) => { setAberto(false); irPara(p); };
  const pode = (p: string) => usuario.permissoes.includes(p);
  return (
    <div className="usuario-menu" ref={caixa}>
      <button className={'usuario-btn' + (aberto ? ' aberto' : '')} onClick={() => setAberto(a => !a)} aria-haspopup="menu" aria-expanded={aberto}>
        <span className="avatar">{iniciais(usuario.nome)}<i className={online ? 'on' : 'off'} /></span>
        <span className="usuario-txt"><strong>{usuario.nome}</strong><small>{PERFIL[usuario.perfil]}</small></span>
        <Ic.seta tamanho={16} />
      </button>
      {aberto && (
        <div className="usuario-pop" role="menu">
          <div className="usuario-cab">
            <span className="avatar grande">{iniciais(usuario.nome)}</span>
            <div><strong>{usuario.nome}</strong><div className="muted small">{PERFIL[usuario.perfil]}</div></div>
          </div>
          <div className="usuario-status">
            <span className={'ponto ' + (online ? 'on' : 'off')} />{online ? 'Conectado ao servidor' : 'Sem conexão'}
            {filaQtd > 0 && <> · <a href="/fila" onClick={e => { e.preventDefault(); ir('/fila'); }}>{filaQtd} na fila</a></>}
          </div>
          <div className="usuario-links so-movel">
            <button role="menuitem" onClick={() => ir('/cadastros/lojas')}><Ic.cadastros tamanho={18} />Cadastros base</button>
            {pode('usuario.gerir') && <button role="menuitem" onClick={() => ir('/usuarios')}><Ic.usuarios tamanho={18} />Usuários</button>}
            <button role="menuitem" onClick={() => ir('/parametros')}><Ic.parametros tamanho={18} />Parâmetros</button>
          </div>
          <button className="usuario-sair" role="menuitem" onClick={() => { setAberto(false); onSair(); }}><Ic.sair tamanho={18} />Sair</button>
        </div>
      )}
    </div>
  );
}

function Shell({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const caminho = useRota();
  const [ref, setRef] = useState<any>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [filaQtd, setFilaQtd] = useState(0);
  const [pend, setPend] = useState<any>({});
  const [toasts, setToasts] = useState<{ id: number; texto: string; tipo: string }[]>([]);
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('sisti:menu') === 'recolhido'; } catch { return false; } });
  const alternarMenu = () => setRecolhido(r => {
    try { localStorage.setItem('sisti:menu', r ? 'aberto' : 'recolhido'); } catch { /* sem armazenamento: só nesta sessão */ }
    return !r;
  });

  const avisar = useCallback((texto: string, tipo: 'ok' | 'erro' | 'info' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);
  const recarregarRef = useCallback(async () => {
    try { setRef((await getComCache('/api/ref')).dados); } catch (e: any) { avisar('Não foi possível carregar os cadastros: ' + e.message, 'erro'); }
  }, [avisar]);
  const sincronizarAgora = useCallback(async () => {
    const r = await sincronizar();
    if (r === null) { setOnline(false); return; }
    setOnline(true);
    if (r.enviados) avisar(`${r.enviados} operação(ões) offline sincronizada(s)` + (r.conflitos ? `; ${r.conflitos} com conflito (veja Fila offline)` : ''), r.conflitos ? 'erro' : 'ok');
  }, [avisar]);

  useEffect(() => { recarregarRef(); }, [recarregarRef]);
  // Pede confirmação ao fechar (ou recarregar) a aba do sistema. O texto da pergunta é do próprio navegador.
  useEffect(() => {
    const confirmar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', confirmar);
    return () => window.removeEventListener('beforeunload', confirmar);
  }, []);
  useEffect(() => {
    const atualizar = () => fila.listar().then(l => setFilaQtd(l.length));
    atualizar();
    const off = aoMudarFila(atualizar);
    const on = () => { setOnline(true); sincronizarAgora(); };
    const of = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', of);
    sincronizarAgora();
    const t = setInterval(sincronizarAgora, 30000);   // tenta a cada 30 s
    return () => { off(); window.removeEventListener('online', on); window.removeEventListener('offline', of); clearInterval(t); };
  }, [sincronizarAgora]);
  // Pendências para os contadores do menu
  useEffect(() => {
    api('GET', '/api/dashboard?meses=1').then(d => setPend(d.pendencias)).catch(() => {});
  }, [caminho]);

  if (!ref) return <div className="muted" style={{ padding: 40 }}>Carregando SisTI…</div>;

  const pode = (p: string) => usuario.permissoes.includes(p);
  const ctx: AppCtx = { usuario, ref, online, filaQtd, pode, navegar: irPara, avisar, recarregarRef, sincronizarAgora };
  const ativo = (p: string) => (p === '/' ? caminho === '/' : caminho.startsWith(p)) ? 'ativo' : '';
  const aprovacoes = Number(pend.orcamentos_pendentes || 0) + Number(pend.baixas_pendentes || 0);

  const filaTotal = filaQtd + Number(pend.conflitos_sync || 0);
  const item = (para: string, rotulo: string, Icone: IconeT, badge = 0, base = para) => (
    <Link para={para} className={'nav-item ' + ativo(base)} rotulo={rotulo}>
      <span className="nav-ic"><Icone />{badge > 0 && <i className="nav-ponto" />}</span>
      <span className="nav-rot">{rotulo}</span>
      {badge > 0 && <span className="badge">{badge}</span>}
    </Link>
  );

  return (
    <App.Provider value={ctx}>
      <div className={'app' + (recolhido ? ' recolhido' : '')}>
        <aside className="sidebar">
          <div className="logo">
            <img src="/icon.svg" alt="" />
            <div className="logo-txt">SisTI<small>Manutenção de TI</small></div>
          </div>
          <nav className="nav">
            <div className="nav-sec"><span>Operação</span></div>
            {item('/', 'Painel', Ic.painel)}
            {item('/equipamentos', 'Equipamentos', Ic.equipamentos)}
            {item('/chamados', 'Chamados', Ic.chamados)}
            {item('/aprovacoes', 'Aprovações', Ic.aprovacoes, aprovacoes)}
            {item('/custos', 'Custos', Ic.custos)}
            {item('/fila', 'Fila offline', Ic.fila, filaTotal)}
            <div className="nav-sec"><span>Cadastros</span></div>
            {item('/cadastros/lojas', 'Cadastros base', Ic.cadastros, 0, '/cadastros')}
            {item('/agenda', 'Agenda', Ic.agenda)}
            {pode('usuario.gerir') && item('/usuarios', 'Usuários', Ic.usuarios)}
            {item('/parametros', 'Parâmetros', Ic.parametros)}
          </nav>
          <button className="nav-item recolher" onClick={alternarMenu} data-rotulo="Expandir menu"
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'} title={recolhido ? undefined : 'Recolher menu (mostrar só os ícones)'}>
            <span className="nav-ic">{recolhido ? <Ic.expandir /> : <Ic.recolher />}</span>
            <span className="nav-rot">Recolher menu</span>
          </button>
        </aside>
        <div className="area">
          <header className="barra-topo">
            <div className="logo-movel"><img src="/icon.svg" alt="" />SisTI</div>
            <div className={'conexao ' + (online ? 'on' : 'off')} title={online ? 'Conectado ao servidor' : 'Sem conexão'}>
              {online ? <Ic.nuvem tamanho={16} /> : <Ic.semNuvem tamanho={16} />}
              <span>{online ? 'Conectado' : 'Sem conexão'}{filaQtd ? ` · ${filaQtd} na fila` : ''}</span>
            </div>
            <MenuUsuario usuario={usuario} online={online} filaQtd={filaQtd} onSair={onSair} />
          </header>
          <main className="main">
            {!online && <div className="faixa-offline"><span><strong>Sem conexão.</strong> Abertura de chamado, recebimento e teste ficam na fila e serão enviados quando a conexão voltar.</span>{filaQtd > 0 && <Link para="/fila">{filaQtd} na fila</Link>}</div>}
            {rota(caminho)}
          </main>
        </div>
        <nav className="menu-movel">
          <Link para="/" className={ativo('/')}><Ic.painel />Painel</Link>
          <Link para="/equipamentos" className={ativo('/equipamentos')}><Ic.equipamentos />Equip.</Link>
          <Link para="/chamados" className={ativo('/chamados')}><Ic.chamados />Chamados</Link>
          <Link para="/agenda" className={ativo('/agenda')}><Ic.agenda />Agenda</Link>
          <Link para="/aprovacoes" className={ativo('/aprovacoes')}><Ic.aprovacoes />Aprovar{aprovacoes > 0 && <i className="nav-ponto" />}</Link>
          <Link para="/fila" className={ativo('/fila')}><Ic.fila />Fila{filaQtd ? ` (${filaQtd})` : ''}</Link>
        </nav>
      </div>
      <div className="toasts">{toasts.map(t => <div key={t.id} className={'toast ' + t.tipo}>{t.texto}</div>)}</div>
    </App.Provider>
  );
}

function Raiz() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    // Sessão salva: valida no servidor; sem conexão, usa o usuário guardado no aparelho
    (async () => {
      if (sessao.token) {
        try { setUsuario(await api('GET', '/api/auth/me')); }
        catch { const u = await cache.get('usuario'); if (u && sessao.token) setUsuario(u); }
      }
      setPronto(true);
    })();
    const sair = () => setUsuario(null);
    window.addEventListener('sisti:sair', sair);
    return () => window.removeEventListener('sisti:sair', sair);
  }, []);
  const sair = async () => {
    const pendentes = await fila.listar();
    if (pendentes.length && !confirm(`Há ${pendentes.length} operação(ões) offline não enviadas. Sair mesmo assim? Elas serão perdidas.`)) return;
    sessao.definir(null); await cache.limpar(); await fila.limpar(); setUsuario(null); irPara('/');
  };
  if (!pronto) return null;
  return usuario ? <Shell usuario={usuario} onSair={sair} /> : <Login onEntrar={setUsuario} />;
}

createRoot(document.getElementById('root')!).render(<Raiz />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
