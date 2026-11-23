// Roteador HTTP mínimo, tratamento de erros e arquivos estáticos.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { ZodError, type ZodTypeAny, type infer as ZInfer } from 'zod';
import type { Usuario } from './auth';

export class HttpError extends Error {
  constructor(public status: number, message: string, public detalhes?: unknown) { super(message); }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  usuario: Usuario | null;
}
export type Handler = (ctx: Ctx) => Promise<unknown>;

interface Rota { metodo: string; partes: string[]; handler: Handler; publica: boolean }

export class Router {
  private rotas: Rota[] = [];
  add(metodo: string, caminho: string, handler: Handler, publica = false) {
    this.rotas.push({ metodo, partes: caminho.split('/').filter(Boolean), handler, publica });
  }
  get(c: string, h: Handler) { this.add('GET', c, h); }
  post(c: string, h: Handler) { this.add('POST', c, h); }
  put(c: string, h: Handler) { this.add('PUT', c, h); }

  match(metodo: string, caminho: string) {
    const partes = caminho.split('/').filter(Boolean);
    for (const r of this.rotas) {
      if (r.metodo !== metodo || r.partes.length !== partes.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < partes.length; i++) {
        if (r.partes[i].startsWith(':')) params[r.partes[i].slice(1)] = decodeURIComponent(partes[i]);
        else if (r.partes[i] !== partes[i]) { ok = false; break; }
      }
      if (ok) return { rota: r, params };
    }
    return null;
  }
}

/** Valida entrada com zod; erro vira HTTP 400 com os campos inválidos. */
export function validar<S extends ZodTypeAny>(schema: S, dados: unknown): ZInfer<S> {
  const r = schema.safeParse(dados);
  if (!r.success) throw r.error;
  return r.data;
}

export async function lerCorpo(req: IncomingMessage, limite = 2_000_000): Promise<any> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > limite) throw new HttpError(413, 'Requisição muito grande');
    partes.push(p as Buffer);
  }
  if (!total) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON inválido'); }
}

export function enviarJson(res: ServerResponse, status: number, dados: unknown) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corpo);
}

export function enviarCsv(res: ServerResponse, nome: string, linhas: Record<string, unknown>[]) {
  const cols = linhas.length ? Object.keys(linhas[0]) : [];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // separador ";" e BOM para abrir direto no Excel em pt-BR
  const csv = '﻿' + [cols.join(';'), ...linhas.map(l => cols.map(c => esc(l[c])).join(';'))].join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"` });
  res.end(csv);
}

/** Converte erros (zod, PostgreSQL, HttpError) em resposta HTTP legível. */
export function tratarErro(res: ServerResponse, e: any) {
  if (e instanceof HttpError) return enviarJson(res, e.status, { erro: e.message, detalhes: e.detalhes });
  if (e instanceof ZodError) {
    return enviarJson(res, 400, { erro: 'Dados inválidos', detalhes: e.issues.map(i => ({ campo: i.path.join('.'), mensagem: i.message })) });
  }
  // Erros do PostgreSQL: regras de negócio (RAISE) e restrições
  switch (e?.code) {
    case 'P0001': return enviarJson(res, 422, { erro: e.message });
    case '23505': return enviarJson(res, 409, { erro: 'Registro duplicado', detalhes: e.detail || e.constraint });
    case '23503': return enviarJson(res, 422, { erro: 'Referência inválida', detalhes: e.detail || e.constraint });
    case '23502': return enviarJson(res, 422, { erro: 'Campo obrigatório ausente', detalhes: e.message });
    case '23514': return enviarJson(res, 422, { erro: 'Regra de validação violada', detalhes: e.constraint });
    case '22P02': return enviarJson(res, 400, { erro: 'Valor em formato inválido', detalhes: e.message });
    case '42501': return enviarJson(res, 403, { erro: 'Sem permissão para esta operação' });
  }
  console.error(e);
  enviarJson(res, 500, { erro: 'Erro interno' });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

/** Serve o front-end; rotas desconhecidas devolvem index.html (SPA). */
export function servirEstatico(res: ServerResponse, raiz: string, caminho: string) {
  const alvo = normalize(join(raiz, caminho));
  let arquivo = alvo.startsWith(raiz) && existsSync(alvo) && statSync(alvo).isFile() ? alvo : join(raiz, 'index.html');
  if (!existsSync(arquivo)) { res.writeHead(404); res.end('Front-end não compilado. Rode: npm run build'); return; }
  const ext = extname(arquivo);
  // app.js/styles.css não têm versão no nome: o navegador revalida sempre para não exibir versão antiga após atualização
  const cache = ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  createReadStream(arquivo).pipe(res);
}
