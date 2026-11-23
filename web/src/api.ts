// Cliente da API: token, erros legíveis, detecção de queda de rede e sincronização da fila.
import { cache, fila, uuid, type TipoOperacao } from './offline';

export class ErroApi extends Error {
  constructor(public status: number, message: string, public detalhes?: any) { super(message); }
}
export class SemConexao extends Error { constructor() { super('Sem conexão com o servidor'); } }

let token = localStorage.getItem('sisti.token');
export const sessao = {
  get token() { return token; },
  definir(t: string | null) { token = t; t ? localStorage.setItem('sisti.token', t) : localStorage.removeItem('sisti.token'); },
};

export async function api<T = any>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new SemConexao();
  }
  const dados = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status === 401 && caminho !== '/api/auth/login') {
    sessao.definir(null);
    window.dispatchEvent(new Event('sisti:sair'));
  }
  if (!r.ok) {
    const det = dados?.detalhes;
    const extra = Array.isArray(det) ? ': ' + det.map((d: any) => `${d.campo || ''} ${d.mensagem || ''}`.trim()).join('; ') : '';
    throw new ErroApi(r.status, (dados?.erro || `Erro ${r.status}`) + extra, det);
  }
  return dados as T;
}

/** Baixa arquivo CSV autenticado. */
export async function baixarCsv(caminho: string, nome: string) {
  const r = await fetch(caminho + (caminho.includes('?') ? '&' : '?') + 'format=csv', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new ErroApi(r.status, 'Falha ao exportar');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a'); a.href = url; a.download = nome + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** GET com cache local: se a rede falhar, devolve a última cópia (marcada como offline). */
export async function getComCache<T = any>(caminho: string): Promise<{ dados: T; offline: boolean; em?: string }> {
  try {
    const dados = await api<T>('GET', caminho);
    cache.set('get:' + caminho, { dados, em: new Date().toISOString() }).catch(() => {});
    return { dados, offline: false };
  } catch (e) {
    if (!(e instanceof SemConexao)) throw e;
    const c = await cache.get<{ dados: T; em: string }>('get:' + caminho);
    if (!c) throw e;
    return { dados: c.dados, offline: true, em: c.em };
  }
}

/**
 * Executa uma ação que pode ser feita offline (abrir chamado, movimentar).
 * Online: envia direto. Sem conexão: guarda na fila e devolve { enfileirado: true }.
 */
export async function acaoOffline(tipo: TipoOperacao, payload: Record<string, unknown>, descricao: string) {
  const id = (payload.id as string) || uuid();
  const ocorrido_em = new Date().toISOString();
  try {
    const resultado = tipo === 'ABRIR_CHAMADO'
      ? await api('POST', '/api/chamados', { ...payload, id, aberto_em: ocorrido_em })
      : await api('POST', `/api/equipamentos/${payload.equipamento_id}/movimentar`, { ...payload, id, ocorrido_em });
    return { enfileirado: false, resultado };
  } catch (e) {
    if (!(e instanceof SemConexao)) throw e;
    await fila.adicionar({ id, tipo, payload, ocorrido_em, descricao });
    return { enfileirado: true, resultado: null };
  }
}

let sincronizando = false;
/** Envia a fila ao servidor. Operações recusadas viram conflito no servidor e saem da fila local. */
export async function sincronizar(): Promise<{ enviados: number; conflitos: number } | null> {
  if (sincronizando || !token) return null;
  const ops = await fila.listar();
  if (!ops.length) return { enviados: 0, conflitos: 0 };
  sincronizando = true;
  try {
    const r = await api<{ resultados: { id: string; ok: boolean; erro?: string }[] }>('POST', '/api/sync', {
      operacoes: ops.map(o => ({ id: o.id, tipo: o.tipo, payload: o.payload, ocorrido_em: o.ocorrido_em })),
    });
    let conflitos = 0;
    for (const res of r.resultados) {
      if (!res.ok) conflitos++;
      await fila.remover(res.id);
    }
    return { enviados: r.resultados.length, conflitos };
  } catch {
    return null;   // continua offline; tenta de novo depois
  } finally {
    sincronizando = false;
  }
}
