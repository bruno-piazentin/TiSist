// SisTI - servidor HTTP: API REST em /api e front-end PWA nas demais rotas.
import { createServer } from 'node:http';
import { config } from './config';
import { pool } from './db';
import { verificarToken, type Usuario } from './auth';
import { enviarJson, HttpError, lerCorpo, Router, servirEstatico, tratarErro } from './http';
import { carregarUsuario, rotasSessao } from './modules/sessao';
import { rotasCadastros } from './modules/cadastros';
import { rotasEquipamentos } from './modules/equipamentos';
import { rotasChamados } from './modules/chamados';
import { rotasOrcamentos } from './modules/orcamentos';
import { rotasCustos } from './modules/custos';
import { rotasDashboard } from './modules/dashboard';
import { rotasSync } from './modules/sync';

const router = new Router();
router.add('GET', '/api/saude', async () => {
  await pool.query('SELECT 1');
  return { ok: true, versao: '1.0.0', hora: new Date().toISOString() };
}, true);
rotasSessao(router);
rotasCadastros(router);
rotasEquipamentos(router);
rotasChamados(router);
rotasOrcamentos(router);
rotasCustos(router);
rotasDashboard(router);
rotasSync(router);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  // Cabeçalhos de segurança básicos
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (!url.pathname.startsWith('/api/')) return servirEstatico(res, config.webDir, url.pathname);

  const inicio = Date.now();
  try {
    const achado = router.match(req.method || 'GET', url.pathname);
    if (!achado) throw new HttpError(404, 'Rota não encontrada');
    let usuario: Usuario | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      usuario = await carregarUsuario(verificarToken(auth.slice(7)));
      if (!usuario) throw new HttpError(401, 'Usuário inativo');
    } else if (!achado.rota.publica) {
      throw new HttpError(401, 'Não autenticado');
    }
    const body = ['POST', 'PUT'].includes(req.method || '') ? await lerCorpo(req) : {};
    const resultado = await achado.rota.handler({ req, res, params: achado.params, query: url.searchParams, body, usuario });
    if (!res.headersSent) enviarJson(res, 200, resultado ?? { ok: true });
  } catch (e) {
    if (!res.headersSent) tratarErro(res, e);
  } finally {
    if (process.env.LOG_REQUISICOES !== '0') {
      console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - inicio}ms`);
    }
  }
});

server.listen(config.porta, () => console.log(`SisTI rodando em http://localhost:${config.porta}`));

// Encerramento limpo (systemd/Docker)
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => { server.close(); pool.end().finally(() => process.exit(0)); });
}
