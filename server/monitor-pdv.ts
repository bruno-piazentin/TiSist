// Monitor de comunicação dos PDVs: a cada ciclo testa o IP de cada PDV ativo e, se configurado,
// consulta o Zabbix (disponibilidade do host e alertas ativos). Grava o resultado em pdv_comunicacao.
//
// Configuração na tela Parâmetros (tabela configuracao, grupos MONITOR_PDV e ZABBIX), lida a cada ciclo:
//   pdv_monitor_segundos  intervalo entre ciclos (0 desliga o monitor)
//   pdv_porta_tcp         testa conexão nessa porta em vez de ping (use se os PDVs bloqueiam ping)
//   zabbix_url            ex.: http://10.10.4.20/zabbix  (a API fica em /api_jsonrpc.php)
//   zabbix_token          token de API de um usuário só de leitura no Zabbix
import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { pool } from './db';
import { exigir } from './auth';
import { HttpError, type Router } from './http';
import { lerConfiguracoes, podeAlterarGrupo } from './modules/configuracao';

const SIMULTANEOS = 20;   // testes em paralelo por ciclo

interface Alvo { id: string; ip: string }
interface Resultado { online: boolean; latenciaMs: number | null }
interface Cfg { intervalo: number; portaTcp: number; zabbixUrl: string; zabbixToken: string }

async function cfg(): Promise<Cfg> {
  const c = await lerConfiguracoes();
  return {
    intervalo: c.pdv_monitor_segundos == null ? 60 : Number(c.pdv_monitor_segundos),
    portaTcp: Number(c.pdv_porta_tcp || 0),
    zabbixUrl: c.zabbix_url || '', zabbixToken: c.zabbix_token || '',
  };
}
const zabbixLigado = (c: Cfg) => !!(c.zabbixUrl && c.zabbixToken);

// Situação exibida na tela Parâmetros
const status = {
  ultimoCiclo: null as string | null, pdvsTestados: 0, erroCiclo: null as string | null,
  zabbixOk: null as string | null, erroZabbix: null as string | null,
};
export const statusMonitor = () => ({ ...status });

/** Testa um IP: ping (2 pacotes, 2 s) ou conexão TCP na porta informada. */
export function testarIp(ip: string, portaTcp = 0): Promise<Resultado> {
  if (portaTcp) {
    return new Promise(resolve => {
      const inicio = Date.now();
      const s = connect({ host: ip, port: portaTcp, timeout: 2000 });
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
  const c = await cfg();
  const r = await testarIp(a.ip, c.portaTcp);
  await gravarTeste(a.id, r);
  if (zabbixLigado(c)) await consultarZabbix(c, [a]).catch(e => avisar('zabbix', e));
  return r;
}

// ---------------- Zabbix ----------------
// Zabbix anterior à 6.4 não aceita o token no cabeçalho: cai para o campo "auth" (lembrado por endereço)
const authNoCorpo = new Set<string>();

async function zabbix(c: Cfg, metodo: string, params: unknown, semAuth = false): Promise<any> {
  const chamar = async () => {
    const noCorpo = authNoCorpo.has(c.zabbixUrl);
    const r = await fetch(c.zabbixUrl + '/api_jsonrpc.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json-rpc', ...(semAuth || noCorpo ? {} : { authorization: 'Bearer ' + c.zabbixToken }) },
      body: JSON.stringify({ jsonrpc: '2.0', method: metodo, params, id: 1, ...(!semAuth && noCorpo ? { auth: c.zabbixToken } : {}) }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',   // não segue redirecionamento: o token não sai para outro endereço
    });
    if (!r.ok) throw new Error(`Zabbix respondeu HTTP ${r.status}`);
    return r.json() as Promise<any>;
  };
  let j = await chamar();
  if (!semAuth && j.error && !authNoCorpo.has(c.zabbixUrl) && /auth|login|session/i.test(`${j.error.message} ${j.error.data}`)) {
    authNoCorpo.add(c.zabbixUrl);
    j = await chamar();
  }
  if (j.error) throw new Error(`Zabbix ${metodo}: ${j.error.message} ${j.error.data || ''}`.trim());
  return j.result;
}

/** Procura os hosts pelo IP da interface e grava disponibilidade e alertas ativos de cada PDV. */
async function consultarZabbix(c: Cfg, alvos: Alvo[]) {
  if (!alvos.length) return;
  const interfaces: { hostid: string; ip: string; available: string }[] =
    await zabbix(c, 'hostinterface.get', { output: ['hostid', 'ip', 'available'], filter: { ip: alvos.map(a => a.ip) } });
  const porIp = new Map<string, { hostid: string; available: string }>();
  for (const i of interfaces) {
    // um host pode ter várias interfaces no mesmo IP: fica a de pior disponibilidade (2 = indisponível)
    const atual = porIp.get(i.ip);
    if (!atual || i.available === '2') porIp.set(i.ip, i);
  }
  const hostids = [...new Set([...porIp.values()].map(h => h.hostid))];
  const gatilhos: any[] = hostids.length ? await zabbix(c, 'trigger.get', {
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
function avisar(origem: 'zabbix' | 'ciclo', e: unknown) {
  const texto = String((e as Error)?.message || e);
  if (origem === 'zabbix') status.erroZabbix = texto; else status.erroCiclo = texto;
  const msg = `${origem}: ${texto}`;
  if (avisados.has(msg)) return;   // não repete o mesmo erro a cada minuto
  avisados.add(msg);
  console.error('[monitor PDV]', msg);
}

/** Um ciclo: devolve o intervalo (s) até o próximo; 0 = monitor desligado. */
async function ciclo(): Promise<{ intervalo: number; c: Cfg | null }> {
  let c: Cfg;
  try { c = await cfg(); } catch (e) { avisar('ciclo', e); return { intervalo: 60, c: null }; }
  if (!c.intervalo) return { intervalo: 0, c };
  try {
    const { rows } = await pool.query<Alvo>('SELECT id, ip FROM sisti.fn_pdv_para_monitorar()');
    for (let i = 0; i < rows.length; i += SIMULTANEOS) {
      await Promise.all(rows.slice(i, i + SIMULTANEOS).map(async a => gravarTeste(a.id, await testarIp(a.ip, c.portaTcp))));
    }
    status.ultimoCiclo = new Date().toISOString(); status.pdvsTestados = rows.length; status.erroCiclo = null;
    if (zabbixLigado(c)) {
      await consultarZabbix(c, rows)
        .then(() => { status.zabbixOk = new Date().toISOString(); status.erroZabbix = null; })
        .catch(e => avisar('zabbix', e));
    }
  } catch (e) {
    avisar('ciclo', e);
  }
  return { intervalo: c.intervalo, c };
}

let ultimaDescricao = '';
export function iniciarMonitorPdv() {
  // Reagenda a cada ciclo com o intervalo atual: mudanças na tela valem sem reiniciar o servidor.
  // Desligado (0), confere de novo a cada minuto se foi religado.
  const proximo = async () => {
    const { intervalo, c } = await ciclo();
    const descricao = !intervalo ? 'desligado (intervalo 0 em Parâmetros)'
      : `a cada ${intervalo}s por ${c?.portaTcp ? 'TCP ' + c.portaTcp : 'ping'}${c && zabbixLigado(c) ? ` + Zabbix (${c.zabbixUrl})` : ''}`;
    if (descricao !== ultimaDescricao) { console.log('Monitor de PDVs:', descricao); ultimaDescricao = descricao; }
    setTimeout(proximo, (intervalo || 60) * 1000).unref();
  };
  setTimeout(proximo, 5_000).unref();
}

/** Botão "Testar conexão" do Zabbix na tela Parâmetros (usa o endereço e o token salvos). */
export function rotasMonitor(r: Router) {
  r.post('/api/configuracoes/ZABBIX/testar', async ({ usuario }) => {
    const u = exigir(usuario);
    if (!podeAlterarGrupo(u, 'ZABBIX')) throw new HttpError(403, 'Seu usuário não pode alterar as configurações do Zabbix');
    const c = await cfg();
    if (!c.zabbixUrl) throw new HttpError(422, 'Informe e salve o endereço do Zabbix');
    try {
      const versao = await zabbix(c, 'apiinfo.version', {}, true);
      if (!c.zabbixToken) return { ok: false, versao, mensagem: `Zabbix ${versao} respondeu, mas falta o token de API` };
      const hosts = await zabbix(c, 'host.get', { countOutput: true });
      status.zabbixOk = new Date().toISOString(); status.erroZabbix = null;
      return { ok: true, versao, mensagem: `Conectado ao Zabbix ${versao}: ${hosts} hosts visíveis para o token` };
    } catch (e) {
      const m = String((e as Error).message);
      return { ok: false, mensagem: /fetch failed|timeout|abort/i.test(m) ? `Sem resposta de ${c.zabbixUrl} (${m})` : m };
    }
  });
}
