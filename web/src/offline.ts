// Armazenamento local (IndexedDB): cache de dados e fila de operações offline (outbox).
const DB_NOME = 'sisti';
const DB_VERSAO = 1;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOME, DB_VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function operar<T>(store: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modo);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => reject(t.error);
  });
}

// ---------- cache chave/valor ----------
export const cache = {
  get: <T = any>(chave: string) => operar<T | undefined>('kv', 'readonly', s => s.get(chave)),
  set: (chave: string, valor: unknown) => operar('kv', 'readwrite', s => { s.put(valor, chave); }),
  limpar: () => operar('kv', 'readwrite', s => { s.clear(); }),
};

// ---------- fila offline ----------
export type TipoOperacao = 'ABRIR_CHAMADO' | 'MOVIMENTAR';
export interface Operacao {
  id: string;                 // UUID gerado aqui: chave de idempotência no servidor
  tipo: TipoOperacao;
  payload: Record<string, unknown>;
  ocorrido_em: string;        // relógio do aparelho
  descricao: string;          // texto para o usuário ver na fila
  tentativas: number;
  erro?: string;
}

export const fila = {
  listar: () => operar<Operacao[]>('fila', 'readonly', s => s.getAll()).then(l => l.sort((a, b) => a.ocorrido_em.localeCompare(b.ocorrido_em))),
  adicionar: (op: Omit<Operacao, 'tentativas'>) => operar('fila', 'readwrite', s => { s.put({ ...op, tentativas: 0 }); }).then(avisar),
  remover: (id: string) => operar('fila', 'readwrite', s => { s.delete(id); }).then(avisar),
  atualizar: (op: Operacao) => operar('fila', 'readwrite', s => { s.put(op); }),
  limpar: () => operar('fila', 'readwrite', s => { s.clear(); }).then(avisar),
};

// Notifica a interface quando a fila muda
const ouvintes = new Set<() => void>();
export function aoMudarFila(fn: () => void) { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; }
function avisar() { ouvintes.forEach(f => f()); }

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  // reserva para navegadores antigos (contexto não seguro)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
