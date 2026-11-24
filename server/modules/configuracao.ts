// Configurações do sistema na tela Parâmetros: endereços de integrações (Zabbix), monitor de PDVs e dados do
// servidor (somente leitura). A alteração é permitida por grupo, conforme o cadastro do usuário.
import { z } from 'zod';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pool, tx, type Db } from '../db';
import { config } from '../config';
import { exigir, type Usuario } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { registrarEvento } from '../evento';

/** Grupos de parâmetros. Cada usuário pode receber permissão para alterar um ou mais grupos. */
export const GRUPOS_PARAMETRO = {
  REGRAS: 'Regras de manutenção',
  SEGURANCA: 'Login e segurança',
  MONITOR_PDV: 'Monitor de PDVs',
  ZABBIX: 'Zabbix',
} as const;
export type GrupoParametro = keyof typeof GRUPOS_PARAMETRO;
export const LISTA_GRUPOS = Object.keys(GRUPOS_PARAMETRO) as GrupoParametro[];

export function podeAlterarGrupo(u: Usuario, grupo: string): boolean {
  return u.perfil === 'ADMIN' || u.parametro_grupos.includes(grupo);
}
/** Vê a seção de integrações e servidor: administrador ou quem altera algum grupo. */
const podeVerConfiguracoes = (u: Usuario) => u.perfil === 'ADMIN' || u.parametro_grupos.length > 0;

// ---------------- Segredos: AES-256-GCM com chave derivada do JWT_SECRET ----------------
const CHAVE = Buffer.from(hkdfSync('sha256', config.jwtSecret, 'sisti', 'configuracao_segredo', 32));
function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', CHAVE, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64');
}
function decifrar(b64: string): string | null {
  try {
    const b = Buffer.from(b64, 'base64');
    const d = createDecipheriv('aes-256-gcm', CHAVE, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;   // JWT_SECRET trocado: o segredo precisa ser informado de novo na tela
  }
}

// ---------------- Leitura (uso interno do servidor, com os segredos abertos) ----------------
let cache: { em: number; valores: Record<string, string | null> } | null = null;

/** Valores atuais das configurações (segredos decifrados). Cache de 5 s; limpo a cada alteração. */
export async function lerConfiguracoes(): Promise<Record<string, string | null>> {
  if (cache && Date.now() - cache.em < 5000) return cache.valores;
  const { rows } = await pool.query(
    `SELECT c.chave, c.tipo, c.valor, s.valor_cifrado FROM sisti.configuracao c
       LEFT JOIN sisti.configuracao_segredo s ON s.chave = c.chave`);
  const valores = Object.fromEntries(rows.map((r: any) =>
    [r.chave, r.tipo === 'SEGREDO' ? (r.valor_cifrado ? decifrar(r.valor_cifrado) : null) : (r.valor || null)]));
  cache = { em: Date.now(), valores };
  return valores;
}

// Variáveis do .env.producao das versões anteriores: importadas uma vez, se a configuração nunca foi alterada na tela
const DO_AMBIENTE: Record<string, string> = {
  pdv_monitor_segundos: 'PDV_MONITOR_SEGUNDOS', pdv_porta_tcp: 'PDV_PORTA_TCP',
  zabbix_url: 'ZABBIX_URL', zabbix_token: 'ZABBIX_TOKEN',
};
export async function importarDoAmbiente() {
  await tx(null, async db => {
    const nunca = await db.query(`SELECT chave, tipo FROM configuracao WHERE atualizado_em IS NULL`);
    const importadas: string[] = [];
    for (const c of nunca) {
      const v = (process.env[DO_AMBIENTE[c.chave]] || '').trim();
      if (!DO_AMBIENTE[c.chave] || !v) continue;
      await gravar(db, c.chave, c.tipo, v, null);
      importadas.push(c.chave);
    }
    if (importadas.length) {
      await registrarEvento(db, { tipo: 'CONFIGURACAO_IMPORTADA', entidade: 'configuracao', payload: { chaves: importadas }, usuarioId: null });
      console.log('Configurações importadas do ambiente (.env):', importadas.join(', '));
    }
  });
  cache = null;
}

async function gravar(db: Db, chave: string, tipo: string, valor: string | null, usuarioId: string | null) {
  if (tipo === 'SEGREDO') {
    await db.query('UPDATE configuracao_segredo SET valor_cifrado = $2 WHERE chave = $1', [chave, valor ? cifrar(valor) : null]);
    await db.query('UPDATE configuracao SET atualizado_em = now(), atualizado_por = $2 WHERE chave = $1', [chave, usuarioId]);
  } else {
    await db.query('UPDATE configuracao SET valor = $2, atualizado_em = now(), atualizado_por = $3 WHERE chave = $1', [chave, valor, usuarioId]);
  }
}

// ---------------- Validação por chave ----------------
const inteiro = (min: number, max: number, nome: string) => (v: string) => {
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) throw new HttpError(422, `${nome}: informe um número inteiro de ${min} a ${max}`);
  return String(Number(v));
};
const VALIDAR: Record<string, (v: string) => string> = {
  pdv_monitor_segundos: v => {
    const n = inteiro(0, 3600, 'Intervalo do teste')(v);
    if (n !== '0' && Number(n) < 15) throw new HttpError(422, 'Intervalo do teste: use 0 (desligado) ou de 15 a 3600 segundos');
    return n;
  },
  pdv_porta_tcp: inteiro(1, 65535, 'Porta TCP'),
  zabbix_url: v => {
    let u: URL;
    try { u = new URL(v); } catch { throw new HttpError(422, 'Endereço do Zabbix inválido. Ex.: http://10.10.4.20/zabbix'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(422, 'Endereço do Zabbix deve começar com http:// ou https://');
    if (u.username || u.password) throw new HttpError(422, 'Não coloque usuário e senha no endereço: use o token de API');
    return v.replace(/\/+$/, '').replace(/\/api_jsonrpc\.php$/, '');
  },
  zabbix_token: v => {
    if (v.length < 16 || /\s/.test(v)) throw new HttpError(422, 'Token de API inválido');
    return v;
  },
};

// ---------------- Dados do servidor (somente leitura) ----------------
function infoServidor() {
  let banco = '—';
  try { const u = new URL(config.databaseUrl); banco = `${u.hostname}:${u.port || 5432} / ${u.pathname.slice(1)} (usuário ${u.username})`; } catch { /* */ }
  const env = (n: string) => process.env[n] || null;
  return [
    { rotulo: 'Versão do SisTI', valor: `${__SISTI_VERSAO__} (${__SISTI_BUILD__})` },
    { rotulo: 'Endereço de acesso', valor: [env('SISTI_DOMINIO'), env('SISTI_IP')].filter(Boolean).join(', ') || null, origem: 'SISTI_DOMINIO / SISTI_IP' },
    { rotulo: 'Certificado HTTPS', valor: env('SISTI_TLS') === 'internal' ? 'Interno (Caddy)' : env('SISTI_TLS'), origem: 'SISTI_TLS' },
    { rotulo: 'Banco de dados', valor: banco, origem: 'DB_APP_PASSWORD (conexão interna do Docker)' },
    { rotulo: 'Conexões com o banco', valor: String(config.poolMax), origem: 'DB_POOL_MAX' },
    { rotulo: 'Duração da sessão', valor: `${config.jwtHoras} horas`, origem: 'JWT_HORAS' },
    { rotulo: 'Backup diário', valor: env('BACKUP_HORA') ? `às ${env('BACKUP_HORA')}, guarda ${env('BACKUP_DIAS') || 30} dias` : null, origem: 'BACKUP_HORA / BACKUP_DIAS' },
    { rotulo: 'Fuso horário', valor: env('TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone, origem: 'TZ' },
    { rotulo: 'Servidor da aplicação', valor: `${hostname()} · Node ${process.version} · porta ${config.porta}` },
    { rotulo: 'No ar desde', valor: new Date(Date.now() - process.uptime() * 1000).toISOString(), tipo: 'DATA' },
  ];
}

export function rotasConfiguracao(r: Router, statusMonitor: () => unknown) {
  r.get('/api/configuracoes', async ({ usuario }) => {
    const u = exigir(usuario);
    if (!podeVerConfiguracoes(u)) throw new HttpError(403, 'Seu usuário não tem acesso às configurações de integração');
    const itens = await tx(u.id, db => db.query(
      `SELECT c.chave, c.grupo, c.rotulo, c.descricao, c.tipo, CASE WHEN c.tipo = 'SEGREDO' THEN NULL ELSE c.valor END AS valor,
              (s.valor_cifrado IS NOT NULL) AS configurado, c.atualizado_em, us.nome AS atualizado_por
         FROM configuracao c LEFT JOIN configuracao_segredo s ON s.chave = c.chave
         LEFT JOIN usuario us ON us.id = c.atualizado_por ORDER BY c.grupo, c.ordem`));
    return {
      grupos: GRUPOS_PARAMETRO,
      editaveis: LISTA_GRUPOS.filter(g => podeAlterarGrupo(u, g)),
      itens, servidor: infoServidor(), monitor: statusMonitor(),
    };
  });

  // Grava um grupo de uma vez. Chave ausente = mantém; null ou '' = limpa; texto = novo valor.
  r.put('/api/configuracoes/:grupo', async ({ usuario, params, body }) => {
    const u = exigir(usuario);
    if (!podeAlterarGrupo(u, params.grupo)) throw new HttpError(403, 'Seu usuário não pode alterar este grupo de parâmetros');
    const { valores } = validar(z.object({ valores: z.record(z.string().max(2000).nullable()) }), body);
    const res = await tx(u.id, async db => {
      const atuais = await db.query(
        `SELECT c.chave, c.tipo, c.valor, s.valor_cifrado FROM configuracao c LEFT JOIN configuracao_segredo s ON s.chave = c.chave
          WHERE c.grupo = $1 FOR UPDATE OF c`, [params.grupo]);
      if (!atuais.length) throw new HttpError(404, 'Grupo sem configurações');
      const porChave = new Map(atuais.map((c: any) => [c.chave, c]));
      const novos: Record<string, string | null> = {};
      for (const [chave, bruto] of Object.entries(valores)) {
        const c: any = porChave.get(chave);
        if (!c) throw new HttpError(422, `Configuração desconhecida neste grupo: ${chave}`);
        const v = (bruto ?? '').trim();
        novos[chave] = v ? (VALIDAR[chave] ? VALIDAR[chave](v) : v) : null;
      }
      // Trocar o endereço do Zabbix sem informar o token apaga o token salvo: ele não pode ser enviado a outro servidor
      let tokenApagado = false;
      const url: any = porChave.get('zabbix_url');
      if (url && 'zabbix_url' in novos && (novos.zabbix_url ?? null) !== (url.valor ?? null) && !novos.zabbix_token
          && porChave.get('zabbix_token')?.valor_cifrado) {
        novos.zabbix_token = null; tokenApagado = true;
      }
      const alteracoes: Record<string, { anterior: string | null; novo: string | null }> = {};
      for (const [chave, v] of Object.entries(novos)) {
        const c: any = porChave.get(chave);
        const segredo = c.tipo === 'SEGREDO';
        const anterior = segredo ? (c.valor_cifrado ? '(configurado)' : null) : c.valor;
        if (!segredo && anterior === v) continue;
        if (segredo && !v && !c.valor_cifrado) continue;
        await gravar(db, chave, c.tipo, v, u.id);
        alteracoes[chave] = { anterior, novo: segredo ? (v ? '(novo token)' : null) : v };
      }
      if (Object.keys(alteracoes).length) {
        await registrarEvento(db, { tipo: 'CONFIGURACAO_ALTERADA', entidade: 'configuracao',
                                    payload: { grupo: params.grupo, alteracoes }, usuarioId: u.id });
      }
      return { ok: true, alteradas: Object.keys(alteracoes), token_apagado: tokenApagado };
    });
    cache = null;
    return res;
  });
}
