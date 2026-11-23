// Ponto de entrada do front-end: login, layout, rotas e ciclo de sincronização offline.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
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
  }
  return <div className="card">Página não encontrada. <Link para="/">Voltar ao início</Link></div>;
}

function Shell({ usuario, onSair }: { usuario: Usuario; onSair: () => void }) {
  const caminho = useRota();
  const [ref, setRef] = useState<any>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [filaQtd, setFilaQtd] = useState(0);
  const [pend, setPend] = useState<any>({});
  const [toasts, setToasts] = useState<{ id: number; texto: string; tipo: string }[]>([]);

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

  return (
    <App.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="logo"><img src="/icon.svg" alt="" /><div>SisTI<small>Manutenção de TI</small></div></div>
          <nav className="nav">
            <div className="nav-sec">Operação</div>
            <Link para="/" className={ativo('/')}>Painel</Link>
            <Link para="/equipamentos" className={ativo('/equipamentos')}>Equipamentos</Link>
            <Link para="/chamados" className={ativo('/chamados')}>Chamados</Link>
            <Link para="/aprovacoes" className={ativo('/aprovacoes')}>Aprovações {aprovacoes > 0 && <span className="badge">{aprovacoes}</span>}</Link>
            <Link para="/custos" className={ativo('/custos')}>Custos</Link>
            <Link para="/fila" className={ativo('/fila')}>Fila offline {(filaQtd + Number(pend.conflitos_sync || 0)) > 0 && <span className="badge">{filaQtd + Number(pend.conflitos_sync || 0)}</span>}</Link>
            <div className="nav-sec">Cadastros</div>
            <Link para="/cadastros/lojas" className={ativo('/cadastros')}>Cadastros base</Link>
            {pode('usuario.gerir') && <Link para="/usuarios" className={ativo('/usuarios')}>Usuários</Link>}
            <Link para="/parametros" className={ativo('/parametros')}>Parâmetros</Link>
          </nav>
          <div className="rodape">
            <strong>{usuario.nome}</strong>{PERFIL[usuario.perfil]}
            <div>{online ? 'Conectado' : 'Sem conexão'}{filaQtd ? ` · ${filaQtd} na fila` : ''}</div>
            <button onClick={onSair}>Sair</button>
          </div>
        </aside>
        <main className="main">
          {!online && <div className="faixa-offline"><span><strong>Sem conexão.</strong> Abertura de chamado, recebimento e teste ficam na fila e serão enviados quando a conexão voltar.</span>{filaQtd > 0 && <Link para="/fila">{filaQtd} na fila</Link>}</div>}
          {rota(caminho)}
        </main>
        <nav className="menu-movel">
          <Link para="/" className={ativo('/')}><span className="ic">◫</span>Painel</Link>
          <Link para="/equipamentos" className={ativo('/equipamentos')}><span className="ic">▣</span>Equip.</Link>
          <Link para="/chamados" className={ativo('/chamados')}><span className="ic">⚑</span>Chamados</Link>
          <Link para="/aprovacoes" className={ativo('/aprovacoes')}><span className="ic">✓</span>Aprovar</Link>
          <Link para="/fila" className={ativo('/fila')}><span className="ic">⇅</span>Fila{filaQtd ? ` (${filaQtd})` : ''}</Link>
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
