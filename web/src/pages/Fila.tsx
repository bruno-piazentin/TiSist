// Fila offline: operações ainda não enviadas (no aparelho) e conflitos registrados no servidor.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { aoMudarFila, fila, type Operacao } from '../offline';
import { Campo, Carregando, Modal, Tabela, dataHora, useAcao, useApp, useCarregar } from '../ui';

export function Fila() {
  const { online, sincronizarAgora, pode, avisar } = useApp();
  const [ops, setOps] = useState<Operacao[]>([]);
  const conf = useCarregar(() => api('GET', '/api/sync/conflitos'), [online]);
  const [resolver, setResolver] = useState<any>(null);
  useEffect(() => { const f = () => fila.listar().then(setOps); f(); return aoMudarFila(f); }, []);

  return (
    <>
      <div className="topo"><div><div className="migalha">Operação</div><h1>Fila offline</h1></div>
        <div className="acoes"><button className="btn primario" disabled={!ops.length} onClick={async () => { await sincronizarAgora(); conf.recarregar(); }}>Sincronizar agora</button></div></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-topo"><h2>Aguardando envio (neste aparelho)</h2><span className="muted small">{online ? 'conectado: o envio é automático a cada 30 s' : 'sem conexão'}</span></div>
        <Tabela linhas={ops} vazio="Nada pendente neste aparelho" colunas={[
          { t: 'Registrado em', c: o => dataHora(o.ocorrido_em) }, { t: 'Operação', c: o => o.tipo === 'ABRIR_CHAMADO' ? 'Abrir chamado' : 'Movimentação', movel: false },
          { t: 'Descrição', c: o => o.descricao },
          { t: '', c: o => <button className="btn pequeno perigo" onClick={() => { if (confirm('Descartar esta operação? Ela não será enviada.')) fila.remover(o.id).then(() => avisar('Operação descartada')); }}>Descartar</button> },
        ]} />
        <p className="muted small" style={{ marginTop: 10 }}>Cada operação tem um identificador único: reenviar não duplica registros. A data registrada é a do aparelho.</p>
      </div>
      <div className="card">
        <div className="card-topo"><h2>Conflitos de sincronização</h2><span className="muted small">operações recusadas pelo servidor porque a situação mudou</span></div>
        <Carregando {...conf}>{() => <Tabela linhas={conf.dados} vazio="Nenhum conflito pendente" colunas={[
          { t: 'Ocorrido em', c: c => dataHora(c.ocorrido_em) }, { t: 'Usuário', c: c => c.usuario }, { t: 'Operação', c: c => c.tipo === 'ABRIR_CHAMADO' ? 'Abrir chamado' : 'Movimentação' },
          { t: 'Motivo da recusa', c: c => <span className="small">{c.erro}</span> },
          { t: '', c: c => pode('chamado.tratar') ? <button className="btn pequeno" onClick={() => setResolver(c)}>Resolver</button> : null },
        ]} />}</Carregando>
      </div>
      {resolver && <Resolver c={resolver} onFechar={() => setResolver(null)} onOk={conf.recarregar} />}
    </>
  );
}

function Resolver({ c, onFechar, onOk }: any) {
  const { avisar } = useApp();
  const [resolucao, setResolucao] = useState('');
  const acao = useAcao();
  const salvar = async () => { if (await acao.executar(() => api('POST', `/api/sync/conflitos/${c.id}/resolver`, { resolucao }))) { avisar('Conflito resolvido'); onOk(); onFechar(); } };
  return (
    <Modal titulo="Resolver conflito" onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando || resolucao.length < 3} onClick={salvar}>Marcar como resolvido</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <div className="aviso atencao">{c.erro}</div>
      <pre className="mono small" style={{ background: '#f4f5f2', padding: 10, borderRadius: 6, overflowX: 'auto' }}>{JSON.stringify(c.payload, null, 2)}</pre>
      <Campo rotulo="O que foi feito (ex.: refeita a movimentação correta)" obrigatorio><textarea value={resolucao} onChange={e => setResolucao(e.target.value)} /></Campo>
    </Modal>
  );
}
