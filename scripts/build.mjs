// Compila servidor (dist/server.cjs) e front-end (dist/web) com esbuild.
// Uso: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const watch = process.argv.includes('--watch');
// Versão (package.json) e data do build, embutidas no servidor e no front-end
const VERSAO = JSON.parse(readFileSync('package.json', 'utf8')).version;
const DATA_BUILD = new Date().toISOString().slice(0, 10);
const definirVersao = { __SISTI_VERSAO__: JSON.stringify(VERSAO), __SISTI_BUILD__: JSON.stringify(DATA_BUILD) };
const alias = process.env.PG_SHIM ? { pg: process.env.PG_SHIM } : {};   // somente testes locais

const servidor = {
  entryPoints: ['server/main.ts'], bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  outfile: 'dist/server.cjs', sourcemap: true, external: process.env.PG_SHIM ? [] : ['pg'], alias, logLevel: 'info', define: definirVersao,
};
const web = {
  entryPoints: ['web/src/main.tsx'], bundle: true, platform: 'browser', target: ['es2020'], format: 'esm',
  outfile: 'dist/web/app.js', sourcemap: true, minify: !watch, jsx: 'automatic', logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"', ...definirVersao },
};

mkdirSync('dist/web', { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'sisti.ico', 'styles.css']) cpSync(`web/${f}`, `dist/web/${f}`);

// Service worker com versão = hash dos arquivos (força atualização do cache a cada build)
function gerarSw() {
  const hash = createHash('sha1');
  for (const f of ['dist/web/app.js', 'dist/web/styles.css', 'dist/web/index.html']) { try { hash.update(readFileSync(f)); } catch {} }
  writeFileSync('dist/web/sw.js', readFileSync('web/sw.js', 'utf8').replace('__VERSAO__', hash.digest('hex').slice(0, 10)));
}

if (watch) {
  const cs = await context(servidor); const cw = await context({ ...web, plugins: [{ name: 'sw', setup(b) { b.onEnd(gerarSw); } }] });
  await Promise.all([cs.watch(), cw.watch()]);
} else {
  await Promise.all([build(servidor), build(web)]);
  gerarSw();
}
