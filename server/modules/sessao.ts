// Login, usuário corrente, dados de referência (cache offline) e gestão de usuários.
import { z } from 'zod';
import { pool, tx } from '../db';
import { assinarToken, exigir, permissoesDo, PERFIS_REDE, type Usuario } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { registrarEvento } from '../evento';
import { LISTA_GRUPOS } from './configuracao';

/** Carrega o usuário ativo com perfil e lojas permitidas. */
export async function carregarUsuario(id: string): Promise<Usuario | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.login, pf.codigo AS perfil, u.alcada_max, u.parametro_grupos,
            coalesce(array_agg(ul.loja_id::text) FILTER (WHERE ul.loja_id IS NOT NULL), '{}') AS lojas
       FROM sisti.usuario u JOIN sisti.perfil pf ON pf.id = u.perfil_id
       LEFT JOIN sisti.usuario_loja ul ON ul.usuario_id = u.id
      WHERE u.id = $1 AND u.ativo
      GROUP BY u.id, pf.codigo`, [id]);
  const u = rows[0];
  if (!u) return null;
  return { ...u, rede_toda: PERFIS_REDE.includes(u.perfil),
           parametro_grupos: u.perfil === 'ADMIN' ? [...LISTA_GRUPOS] : u.parametro_grupos.filter((g: string) => (LISTA_GRUPOS as string[]).includes(g)) };
}

/**
 * Confere login e senha com bloqueio temporário após erros seguidos (parâmetros login_tentativas_max e
 * login_bloqueio_minutos). Retorna { id } no acerto; { bloqueadoMin } se o usuário está bloqueado;
 * {} (com `restam` = tentativas antes do bloqueio) no erro. Login inexistente ou inativo também volta {}.
 * Enquanto bloqueado, a senha nem é conferida: nem a senha certa entra.
 */
async function conferirSenha(login: string, senha: string): Promise<{ id?: string; bloqueadoMin?: number; restam?: number }> {
  return tx(null, async db => {
    // FOR UPDATE: tentativas simultâneas do mesmo login são contadas uma de cada vez
    const u = await db.one(
      `SELECT id, tentativas_falhas,
              ceil(extract(epoch FROM bloqueado_ate - now()) / 60)::int AS min_restantes,
              senha_hash = crypt($2, senha_hash) AS senha_ok
         FROM usuario WHERE lower(login) = lower($1) AND ativo AND senha_hash IS NOT NULL
          FOR UPDATE`, [login, senha]);
    if (!u) return {};
    if (u.min_restantes > 0) return { bloqueadoMin: u.min_restantes };
    if (u.senha_ok) {
      await db.query('UPDATE usuario SET ultimo_acesso = now(), tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1', [u.id]);
      return { id: u.id };
    }
    const par = Object.fromEntries((await db.query(
      `SELECT chave, valor FROM parametro WHERE chave IN ('login_tentativas_max', 'login_bloqueio_minutos')`))
      .map((p: any) => [p.chave, Number(p.valor)]));
    const max = par.login_tentativas_max || 3, minutos = par.login_bloqueio_minutos || 5;
    const falhas = u.tentativas_falhas + 1;
    if (falhas < max) {
      await db.query('UPDATE usuario SET tentativas_falhas = $2 WHERE id = $1', [u.id, falhas]);
      return { restam: max - falhas };
    }
    // atingiu o limite: bloqueia e zera a contagem para o próximo ciclo
    await db.query(`UPDATE usuario SET tentativas_falhas = 0, bloqueado_ate = now() + $2 * interval '1 minute' WHERE id = $1`,
                   [u.id, minutos]);
    await registrarEvento(db, { tipo: 'LOGIN_BLOQUEADO', entidade: 'usuario', entidadeId: u.id,
                                payload: { tentativas: falhas, minutos }, usuarioId: u.id });
    return { bloqueadoMin: minutos };
  });
}

export function rotasSessao(r: Router) {
  r.add('POST', '/api/auth/login', async ({ body }) => {
    const { login, senha } = validar(z.object({ login: z.string().min(1), senha: z.string().min(1) }), body);
    const r = await conferirSenha(login, senha);
    if (r.bloqueadoMin) {
      throw new HttpError(429, `Acesso bloqueado por excesso de senhas erradas. Tente novamente em ${r.bloqueadoMin} minuto(s) ` +
                               'ou peça ao administrador para desbloquear.');
    }
    if (!r.id) {
      throw new HttpError(401, r.restam === 1 ? 'Login ou senha inválidos. Atenção: mais um erro bloqueia o acesso.'
                                              : 'Login ou senha inválidos');
    }
    const usuario = (await carregarUsuario(r.id))!;
    return { token: assinarToken(usuario), usuario: { ...usuario, permissoes: permissoesDo(usuario) } };
  }, true);

  r.get('/api/auth/me', async ({ usuario }) => {
    const u = exigir(usuario);
    return { ...u, permissoes: permissoesDo(u) };
  });

  r.post('/api/auth/senha', async ({ usuario, body }) => {
    const u = exigir(usuario);
    const d = validar(z.object({ atual: z.string(), nova: z.string().min(8, 'Mínimo de 8 caracteres') }), body);
    const { rowCount } = await pool.query(
      `UPDATE sisti.usuario SET senha_hash = crypt($3, gen_salt('bf', 10))
        WHERE id = $1 AND senha_hash = crypt($2, senha_hash)`, [u.id, d.atual, d.nova]);
    if (!rowCount) throw new HttpError(422, 'Senha atual incorreta');
    return { ok: true };
  });

  // Tabelas de apoio: usadas nos formulários e guardadas no aparelho para uso offline
  r.get('/api/ref', async ({ usuario }) => {
    const u = exigir(usuario);
    return tx(u.id, async db => {
      const [lojas, departamentos, grupos, marcas, fabricantes, marcaFabricante, produtos, fornecedores, servicos,
             categorias, perfis, transicoes, parametros] = await Promise.all([
        db.query(`SELECT id, codigo, nome_fantasia, tipo, situacao, critica, area_m2, qtd_checkouts, ativo FROM loja
                   WHERE $1 OR id = ANY($2::uuid[]) ORDER BY codigo`, [u.rede_toda, u.lojas]),
        db.query('SELECT id, codigo, nome, centro_custo, ativo FROM departamento ORDER BY nome'),
        db.query('SELECT id, codigo, nome, grupo_pai_id, vida_util_meses, ativo FROM grupo_produto ORDER BY nome'),
        db.query('SELECT id, nome, ativo FROM marca ORDER BY nome'),
        db.query('SELECT id, razao_social, ativo FROM fabricante ORDER BY razao_social'),
        db.query('SELECT marca_id, fabricante_id FROM marca_fabricante'),
        db.query(`SELECT id, descricao, modelo, marca_id, fabricante_id, grupo_id, cor_padrao, garantia_meses, ativo_catalogo
                    FROM produto ORDER BY modelo`),
        db.query('SELECT id, razao_social, tipos, homologado, sla_orcamento_dias, sla_reparo_dias, ativo FROM fornecedor ORDER BY razao_social'),
        db.query('SELECT id, tipo, descricao, unidade_cobranca, valor_referencia, ativo FROM servico ORDER BY descricao'),
        db.query('SELECT id, codigo, nome, grupo_id, ativo FROM categoria_falha ORDER BY nome'),
        db.query('SELECT id, codigo, nome FROM perfil ORDER BY nome'),
        db.query('SELECT * FROM transicao_status'),
        db.query('SELECT chave, valor, descricao, grupo FROM parametro ORDER BY grupo, chave'),
      ]);
      return { lojas, departamentos, grupos, marcas, fabricantes, marcaFabricante, produtos, fornecedores, servicos,
               categorias, perfis, transicoes, parametros, geradoEm: new Date().toISOString() };
    });
  });

  // ---------------- Usuários (somente administrador) ----------------
  const usuarioSchema = z.object({
    nome: z.string().min(3), email: z.string().email(), login: z.string().min(3),
    perfil_id: z.string().uuid(), departamento_id: z.string().uuid().nullish(),
    alcada_max: z.coerce.number().min(0).default(0), ativo: z.boolean().default(true),
    telefone: z.string().nullish(), lojas: z.array(z.string().uuid()).default([]),
    senha: z.string().min(8).optional(),
    parametro_grupos: z.array(z.enum(LISTA_GRUPOS as [string, ...string[]])).default([]),
  });

  r.get('/api/usuarios', async ({ usuario }) => {
    const u = exigir(usuario, 'usuario.gerir');
    return tx(u.id, db => db.query(
      `SELECT u.id, u.nome, u.email, u.login, u.perfil_id, pf.codigo AS perfil, u.departamento_id, u.alcada_max, u.ativo,
              u.telefone, u.ultimo_acesso, u.parametro_grupos, CASE WHEN u.bloqueado_ate > now() THEN u.bloqueado_ate END AS bloqueado_ate,
              coalesce(array_agg(ul.loja_id::text) FILTER (WHERE ul.loja_id IS NOT NULL), '{}') AS lojas
         FROM usuario u JOIN perfil pf ON pf.id = u.perfil_id LEFT JOIN usuario_loja ul ON ul.usuario_id = u.id
        GROUP BY u.id, pf.codigo ORDER BY u.nome`));
  });

  const salvarUsuario = async (atual: Usuario, body: unknown, id?: string) => {
    const d = validar(id ? usuarioSchema.partial({ senha: true }) : usuarioSchema.required({ senha: true }), body);
    return tx(atual.id, async db => {
      const row = id
        ? await db.one(`UPDATE usuario SET nome=$2, email=$3, login=$4, perfil_id=$5, departamento_id=$6, alcada_max=$7,
                          ativo=$8, telefone=$9, parametro_grupos=$11, senha_hash = CASE WHEN $10::text IS NULL THEN senha_hash ELSE crypt($10, gen_salt('bf', 10)) END,
                          -- senha nova definida pelo administrador também libera um login bloqueado
                          tentativas_falhas = CASE WHEN $10::text IS NULL THEN tentativas_falhas ELSE 0 END,
                          bloqueado_ate = CASE WHEN $10::text IS NULL THEN bloqueado_ate END
                        WHERE id=$1 RETURNING id`,
                       [id, d.nome, d.email, d.login, d.perfil_id, d.departamento_id ?? null, d.alcada_max, d.ativo, d.telefone ?? null, d.senha ?? null, d.parametro_grupos])
        : await db.one(`INSERT INTO usuario (nome, email, login, perfil_id, departamento_id, alcada_max, ativo, telefone, senha_hash, parametro_grupos)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, crypt($9, gen_salt('bf', 10)), $10) RETURNING id`,
                       [d.nome, d.email, d.login, d.perfil_id, d.departamento_id ?? null, d.alcada_max, d.ativo, d.telefone ?? null, d.senha, d.parametro_grupos]);
      if (!row) throw new HttpError(404, 'Usuário não encontrado');
      // usuario_loja: substitui o conjunto (tabela de vínculo; histórico fica no evento)
      const antes = (await db.query('SELECT loja_id::text FROM usuario_loja WHERE usuario_id = $1', [row.id])).map((a: any) => a.loja_id);
      // só as lojas novas (uma loja já vinculada e depois inativada continua vinculada sem erro)
      const novas = d.lojas.filter(l => !antes.includes(l));
      if (novas.length) await db.query('INSERT INTO usuario_loja SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [row.id, novas]);
      const remover = antes.filter((l: string) => !d.lojas.includes(l));
      if (remover.length) {
        // a aplicação não tem DELETE; a remoção de vínculo usa função do administrador
        await db.query('SELECT fn_desvincular_lojas($1, $2::uuid[])', [row.id, remover]);
      }
      await registrarEvento(db, { tipo: 'USUARIO_SALVO', entidade: 'usuario', entidadeId: row.id,
                                  payload: { perfil_id: d.perfil_id, alcada_max: d.alcada_max, ativo: d.ativo, lojas: d.lojas, parametro_grupos: d.parametro_grupos }, usuarioId: atual.id });
      return { id: row.id };
    });
  };
  r.post('/api/usuarios', async ({ usuario, body }) => salvarUsuario(exigir(usuario, 'usuario.gerir'), body));
  r.put('/api/usuarios/:id', async ({ usuario, body, params }) => salvarUsuario(exigir(usuario, 'usuario.gerir'), body, params.id));

  // Libera um login bloqueado por senhas erradas antes de o tempo acabar
  r.post('/api/usuarios/:id/desbloquear', async ({ usuario, params }) => {
    const u = exigir(usuario, 'usuario.gerir');
    return tx(u.id, async db => {
      const row = await db.one('UPDATE usuario SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1 RETURNING id', [params.id]);
      if (!row) throw new HttpError(404, 'Usuário não encontrado');
      await registrarEvento(db, { tipo: 'LOGIN_DESBLOQUEADO', entidade: 'usuario', entidadeId: row.id, payload: {}, usuarioId: u.id });
      return { ok: true };
    });
  });
}
