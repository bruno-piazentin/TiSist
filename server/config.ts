// Configuração lida de variáveis de ambiente (ver .env.example)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega um arquivo .env simples (CHAVE=valor), sem dependências externas
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  for (const linha of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function obrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida`);
  return v;
}

export const config = {
  porta: Number(process.env.PORT || 3000),
  databaseUrl: obrigatoria('DATABASE_URL'),
  jwtSecret: obrigatoria('JWT_SECRET'),
  jwtHoras: Number(process.env.JWT_HORAS || 12),
  webDir: resolve(process.env.WEB_DIR || 'dist/web'),
  poolMax: Number(process.env.DB_POOL_MAX || 10),
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres');
}
