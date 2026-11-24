// Monitor de comunicação dos PDVs: a cada ciclo testa o IP de cada PDV ativo e, se configurado,
// consulta o Zabbix (disponibilidade do host e alertas ativos). Grava o resultado em pdv_comunicacao.
//
// Variáveis de ambiente (todas opcionais):
//   PDV_MONITOR_SEGUNDOS  intervalo entre ciclos (padrão 60; 0 desliga o monitor)
//   PDV_PORTA_TCP         testa conexão nessa porta em vez de ping (use se os PDVs bloqueiam ping)
//   ZABBIX_URL            ex.: http://10.10.4.20/zabbix  (a API fica em /api_jsonrpc.php)
//   ZABBIX_TOKEN          token de API de um usuário só de leitura no Zabbix
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { pool } from './db';

const INTERVALO = Number(process.env.PDV_MONITOR_SEGUNDOS || 60);   // '0' desliga; vazio = 60
const PORTA_TCP = Number(process.env.PDV_PORTA_TCP || 0);
const ZABBIX_URL = (process.env.ZABBIX_URL || '').replace(/\/+$/, '').replace(/\/api_jsonrpc\.php$/, '');
const ZABBIX_TOKEN = process.env.ZABBIX_TOKEN || '';
const SIMULTANEOS = 20;   // testes em paralelo por ciclo

interface Alvo { id: string; ip: string }
interface Resultado { online: boolean; latenciaMs: number | null }

/** Testa um IP: ping (2 pacotes, 2 s) ou conexão TCP na porta configurada. */
export function testarIp(ip: string): Promise<Resultado> {
  if (PORTA_TCP) {
    return new Promise(resolve => {
      const inicio = Date.now();
      const s = connect({ host: ip, port: PORTA_TCP, timeout: 2000 });
      const fim = (online: boolean) => { s.destroy(); resolve({ online, latenciaMs: online ? Date.now() - inicio : null }); };
      s.once('connect', () => fim(true)).once('timeout', () => fim(false)).once('error', () => fim(false));
    });
  }
  const args = process.platform === 'win32' ? ['-n', '2', '-w', '2000', ip] : ['-c', '2', '-W', '2', '-q', ip];
  return new Promise(resolve => {
    execFile('ping', args, { timeout: 8000, windowsHide: true }, (erro, saida) => {
      const texto = String(saida || '');
      // No Windows o ping sai com código 0 até em "host inacessível": exige TTL na resposta
      const online = !erro && (process.platform !== 'win32' || /ttl=/i.test(texto));
      const m = texto.match(/(?:time|tempo)[=<]\s*([\d.,]+)\s*ms/i) || texto.match(/= [\d.]+\/([\d.]+)\//);   // linux -q: rtt min/avg/max
      resolve({ online, latenciaMs: online && m ? Math.round(parseFloat(m[1].replace(',', '.'))) : null });
    });
  });
}

async function gravarTeste(id: string, r: Resultado) {
  await pool.query(
    `INSERT INTO sisti.pdv_comunicacao (pdv_id, online, verificado_em, ultima_resposta, offline_desde, latencia_ms)
     VALUES ($1, $2, now(), CASE WHEN $2 THEN now() END, CASE WHEN $2 THEN NULL ELSE now() END, $3)
     ON CONFLICT (pdv_id) DO UPDATE SET
       online = EXCLUDED.online, verificado_em = now(), latencia_ms = EXCLUDED.latencia_ms,
       ultima_resposta = coalesce(EXCLUDED.ultima_resposta, pdv_comunicacao.ultima_resposta),
       offline_desde = CASE WHEN EXCLUDED.online THEN NULL ELSE coalesce(pdv_comunicacao.offline_desde, now()) END`,
    [id, r.online, r.latenciaMs]);
}

/** Testa um PDV agora e grava o resultado (botão "Testar agora" e ciclo do monitor). */
export async function verificarPdv(a: Alvo) {
  const r = await testarIp(a.ip);
  await gravarTeste(a.id, r);
  if (ZABBIX_URL && ZABBIX_TOKEN) await consultarZabbix([a]).catch(e => avisar('zabbix', e));
  return r;
}

// ---------------- Zabbix ----------------
let authNoCorpo = false;   // Zabbix anterior à 6.4 não aceita o token no cabeçalho: cai para o campo "auth"

async function zabbix(metodo: string, params: unknown): Promise<any> {
  const chamar = async () => {
    const r = await fetch(ZABBIX_URL + '/api_jsonrpc.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json-rpc', ...(authNoCorpo ? {} : { authorization: 'Bearer ' + ZABBIX_TOKEN }) },
      body: JSON.stringify({ jsonrpc: '2.0', method: metodo, params, id: 1, ...(authNoCorpo ? { auth: ZABBIX_TOKEN } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Zabbix respondeu HTTP ${r.status}`);
    return r.json() as Promise<any>;
  };
  let j = await chamar();
  if (j.error && !authNoCorpo && /auth|login|session/i.test(`${j.error.message} ${j.error.data}`)) {
    authNoCorpo = true;
    j = await chamar();
  }
  if (j.error) throw new Error(`Zabbix ${metodo}: ${j.error.message} ${j.error.data || ''}`.trim());
  return j.result;
}

/** Procura os hosts pelo IP da interface e grava disponibilidade e alertas ativos de cada PDV. */
async function consultarZabbix(alvos: Alvo[]) {
  if (!alvos.length) return;
  const interfaces: { hostid: string; ip: string; available: string }[] =
    await zabbix('hostinterface.get', { output: ['hostid', 'ip', 'available'], filter: { ip: alvos.map(a => a.ip) } });
  const porIp = new Map<string, { hostid: string; available: string }>();
  for (const i of interfaces) {
    // um host pode ter várias interfaces no mesmo IP: fica a de pior disponibilidade (2 = indisponível)
    const atual = porIp.get(i.ip);
    if (!atual || i.available === '2') porIp.set(i.ip, i);
  }
  const hostids = [...new Set([...porIp.values()].map(h => h.hostid))];
  const gatilhos: any[] = hostids.length ? await zabbix('trigger.get', {
    output: ['description', 'priority', 'lastchange'], hostids, selectHosts: ['hostid'],
    filter: { value: 1 }, monitored: true, skipDependent: true, expandDescription: true,
  }) : [];
  const SEV = ['Não classificado', 'Informação', 'Atenção', 'Média', 'Alta', 'Desastre'];
  for (const a of alvos) {
    const h = porIp.get(a.ip);
    const problemas = h ? gatilhos.filter(t => t.hosts?.some((x: any) => x.hostid === h.hostid)).map(t => ({
      nome: t.description, severidade: SEV[Number(t.priority)] ?? t.priority, nivel: Number(t.priority),
      desde: new Date(Number(t.lastchange) * 1000).toISOString(),
    })) : null;
    const disponivel = !h ? null : h.available === '1' ? true : h.available === '2' ? false : null;
    await pool.query(
      `INSERT INTO sisti.pdv_comunicacao (pdv_id, zabbix_disponivel, zabbix_problemas, zabbix_verificado_em)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (pdv_id) DO UPDATE SET zabbix_disponivel = $2, zabbix_problemas = $3, zabbix_verificado_em = now()`,
      [a.id, disponivel, problemas === null ? null : JSON.stringify(problemas)]);
  }
}

// ---------------- ciclo ----------------
const avisados = new Set<string>();
function avisar(origem: string, e: unknown) {
  const msg = `${origem}: ${(e as Error)?.message || e}`;
  if (avisados.has(msg)) return;   // não repete o mesmo erro a cada minuto
  avisados.add(msg);
  console.error('[monitor PDV]', msg);
}

let rodando = false;
async function ciclo() {
  if (rodando) return;
  rodando = true;
  try {
    const { rows } = await pool.query<Alvo>('SELECT id, ip FROM sisti.fn_pdv_para_monitorar()');
    for (let i = 0; i < rows.length; i += SIMULTANEOS) {
      await Promise.all(rows.slice(i, i + SIMULTANEOS).map(async a => gravarTeste(a.id, await testarIp(a.ip))));
    }
    if (ZABBIX_URL && ZABBIX_TOKEN) await consultarZabbix(rows).catch(e => avisar('zabbix', e));
  } catch (e) {
    avisar('ciclo', e);
  } finally {
    rodando = false;
  }
}

export function iniciarMonitorPdv() {
  if (!INTERVALO) { console.log('Monitor de PDVs desligado (PDV_MONITOR_SEGUNDOS=0)'); return; }
  console.log(`Monitor de PDVs: a cada ${INTERVALO}s por ${PORTA_TCP ? 'TCP ' + PORTA_TCP : 'ping'}` +
              (ZABBIX_URL && ZABBIX_TOKEN ? ` + Zabbix (${ZABBIX_URL})` : ''));
  setTimeout(ciclo, 5_000);
  setInterval(ciclo, INTERVALO * 1000).unref();
}
