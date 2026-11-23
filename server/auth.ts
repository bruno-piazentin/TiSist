// Autenticação (JWT HS256 com node:crypto) e permissões por perfil (RBAC).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';
import { HttpError } from './http';

export type Perfil = 'ADMIN' | 'GESTOR_TI' | 'COORDENADOR' | 'TECNICO' | 'GERENTE_LOJA' | 'COMPRAS' | 'AUDITORIA' | 'DIRETORIA';

export interface Usuario {
  id: string;
  nome: string;
  login: string;
  perfil: Perfil;
  alcada_max: number;
  lojas: string[];        // lojas permitidas (vazio = rede toda para perfis de rede)
  rede_toda: boolean;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function assinarToken(u: Usuario): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const agora = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: u.id, perfil: u.perfil, iat: agora, exp: agora + config.jwtHoras * 3600 }));
  const assinatura = b64url(createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${assinatura}`;
}

/** Valida o token e devolve o id do usuário (ou lança 401). */
export function verificarToken(token: string): string {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new HttpError(401, 'Token inválido');
  const esperado = createHmac('sha256', config.jwtSecret).update(`${h}.${p}`).digest();
  const recebido = Buffer.from(s, 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw new HttpError(401, 'Token inválido');
  const dados = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (typeof dados.exp !== 'number' || dados.exp < Date.now() / 1000) throw new HttpError(401, 'Sessão expirada');
  return dados.sub;
}

export const PERFIS_REDE: Perfil[] = ['ADMIN', 'GESTOR_TI', 'COORDENADOR', 'COMPRAS', 'AUDITORIA', 'DIRETORIA'];

// Matriz de permissões (seção 10 da especificação)
const PERMISSOES = {
  'parametro.gerir':     ['ADMIN'],
  'usuario.gerir':       ['ADMIN'],
  'cadastro.gerir':      ['ADMIN', 'GESTOR_TI', 'COORDENADOR'],
  'fornecedor.gerir':    ['ADMIN', 'GESTOR_TI', 'COORDENADOR', 'COMPRAS'],
  'equipamento.gerir':   ['ADMIN', 'GESTOR_TI', 'COORDENADOR', 'TECNICO'],
  'chamado.abrir':       ['GESTOR_TI', 'COORDENADOR', 'TECNICO', 'GERENTE_LOJA'],
  'chamado.tratar':      ['GESTOR_TI', 'COORDENADOR', 'TECNICO'],
  'movimentar':          ['GESTOR_TI', 'COORDENADOR', 'TECNICO', 'GERENTE_LOJA'],
  'orcamento.registrar': ['GESTOR_TI', 'COORDENADOR', 'TECNICO', 'COMPRAS'],
  'orcamento.aprovar':   ['GESTOR_TI', 'COORDENADOR', 'COMPRAS', 'DIRETORIA'],
  'baixa.solicitar':     ['GESTOR_TI', 'COORDENADOR', 'TECNICO'],
  'baixa.aprovar':       ['GESTOR_TI', 'COORDENADOR', 'DIRETORIA'],
  'custo.lancar':        ['COMPRAS'],
  'custo.fechar':        ['COMPRAS'],
  'agenda.gerir':        ['GESTOR_TI', 'COORDENADOR', 'TECNICO'],
  'auditoria.ver':       ['ADMIN', 'AUDITORIA', 'DIRETORIA', 'GESTOR_TI'],
} satisfies Record<string, Perfil[]>;
export type Permissao = keyof typeof PERMISSOES;

export function pode(u: Usuario, p: Permissao): boolean {
  return (PERMISSOES[p] as Perfil[]).includes(u.perfil);
}
export function exigir(u: Usuario | null, p?: Permissao): Usuario {
  if (!u) throw new HttpError(401, 'Não autenticado');
  if (p && !pode(u, p)) throw new HttpError(403, 'Seu perfil não permite esta ação');
  return u;
}
export function permissoesDo(u: Usuario): Permissao[] {
  return (Object.keys(PERMISSOES) as Permissao[]).filter(p => pode(u, p));
}
