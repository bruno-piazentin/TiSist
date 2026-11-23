// Login, usuário corrente, dados de referência (cache offline) e gestão de usuários.
import { z } from 'zod';
import { pool, tx } from '../db';
import { assinarToken, exigir, permissoesDo, PERFIS_REDE, type Usuario } from '../auth';
import { HttpError, validar, type Router } from '../http';

/** Carrega o usuário ativo com perfil e lojas permitidas. */
export async function carregarUsuario(id: string): Promise<Usuario | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.login, pf.codigo AS perfil, u.alcada_max,
            coalesce(array_agg(ul.loja_id::text) FILTER (WHERE ul.loja_id IS NOT NULL), '{}') AS lojas
       FROM sisti.usuario u JOIN sisti.perfil pf ON pf.id = u.perfil_id
       LEFT JOIN sisti.usuario_loja ul ON ul.usuario_id = u.id
      WHERE u.id = $1 AND u.ativo
      GROUP BY u.id, pf.codigo`, [id]);
  const u = rows[0];
  if (!u) return null;
  return { ...u, rede_toda: PERFIS_REDE.includes(u.perfil) };
}

export function rotasSessao(r: Router) {
  r.add('POST', '/api/auth/login', async ({ body }) => {
    const { login, senha } = validar(z.object({ login: z.string().min(1), senha: z.string().min(1) }), body);
    // bcrypt via pgcrypto: a senha nunca é comparada em texto na aplicação
    const { rows } = await pool.query(
      `UPDATE sisti.usuario SET ultimo_acesso = now()
        WHERE lower(login) = lower($1) AND ativo AND senha_hash IS NOT NULL AND senha_hash = crypt($2, senha_hash)
        RETURNING id`, [login, senha]);
    if (!rows[0]) throw new HttpError(401, 'Login ou senha inválidos');
    const usuario = (await carregarUsuario(rows[0].id))!;
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
        db.query(`SELECT id, codigo, nome_fantasia, tipo, situacao, critica, area_m2, qtd_checkouts FROM loja
                   WHERE $1 OR id = ANY($2::uuid[]) ORDER BY codigo`, [u.rede_toda, u.lojas]),
        db.query('SELECT id, codigo, nome, centro_custo, ativo FROM departamento ORDER BY nome'),
        db.query('SELECT id, codigo, nome, grupo_pai_id, vida_util_meses FROM grupo_produto ORDER BY nome'),
        db.query('SELECT id, nome FROM marca ORDER BY nome'),
        db.query('SELECT id, razao_social FROM fabricante ORDER BY razao_social'),
        db.query('SELECT marca_id, fabricante_id FROM marca_fabricante'),
        db.query(`SELECT id, descricao, modelo, marca_id, fabricante_id, grupo_id, cor_padrao, garantia_meses, ativo_catalogo
                    FROM produto ORDER BY modelo`),
        db.query('SELECT id, razao_social, tipos, homologado, sla_orcamento_dias, sla_reparo_dias FROM fornecedor ORDER BY razao_social'),
        db.query('SELECT id, tipo, descricao, unidade_cobranca, valor_referencia FROM servico ORDER BY descricao'),
        db.query('SELECT id, codigo, nome, grupo_id FROM categoria_falha ORDER BY nome'),
        db.query('SELECT id, codigo, nome FROM perfil ORDER BY nome'),
        db.query('SELECT * FROM transicao_status'),
        db.query('SELECT chave, valor, descricao FROM parametro ORDER BY chave'),
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
  });

  r.get('/api/usuarios', async ({ usuario }) => {
    const u = exigir(usuario, 'usuario.gerir');
    return tx(u.id, db => db.query(
      `SELECT u.id, u.nome, u.email, u.login, u.perfil_id, pf.codigo AS perfil, u.departamento_id, u.alcada_max, u.ativo,
              u.telefone, u.ultimo_acesso,
              coalesce(array_agg(ul.loja_id::text) FILTER (WHERE ul.loja_id IS NOT NULL), '{}') AS lojas
         FROM usuario u JOIN perfil pf ON pf.id = u.perfil_id LEFT JOIN usuario_loja ul ON ul.usuario_id = u.id
        GROUP BY u.id, pf.codigo ORDER BY u.nome`));
  });

  const salvarUsuario = async (atual: Usuario, body: unknown, id?: string) => {
    const d = validar(id ? usuarioSchema.partial({ senha: true }) : usuarioSchema.required({ senha: true }), body);
    return tx(atual.id, async db => {
      const row = id
        ? await db.one(`UPDATE usuario SET nome=$2, email=$3, login=$4, perfil_id=$5, departamento_id=$6, alcada_max=$7,
                          ativo=$8, telefone=$9, senha_hash = CASE WHEN $10::text IS NULL THEN senha_hash ELSE crypt($10, gen_salt('bf', 10)) END
                        WHERE id=$1 RETURNING id`,
                       [id, d.nome, d.email, d.login, d.perfil_id, d.departamento_id ?? null, d.alcada_max, d.ativo, d.telefone ?? null, d.senha ?? null])
        : await db.one(`INSERT INTO usuario (nome, email, login, perfil_id, departamento_id, alcada_max, ativo, telefone, senha_hash)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, crypt($9, gen_salt('bf', 10))) RETURNING id`,
                       [d.nome, d.email, d.login, d.perfil_id, d.departamento_id ?? null, d.alcada_max, d.ativo, d.telefone ?? null, d.senha]);
      if (!row) throw new HttpError(404, 'Usuário não encontrado');
      // usuario_loja: substitui o conjunto (tabela de vínculo; histórico fica no evento)
      const antes = await db.query('SELECT loja_id::text FROM usuario_loja WHERE usuario_id = $1', [row.id]);
      await db.query('INSERT INTO usuario_loja SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [row.id, d.lojas]);
      const remover = antes.map((a: any) => a.loja_id).filter((l: string) => !d.lojas.includes(l));
      if (remover.length) {
        // a aplicação não tem DELETE; a remoção de vínculo usa função do administrador
        await db.query('SELECT fn_desvincular_lojas($1, $2::uuid[])', [row.id, remover]);
      }
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, payload, usuario_id, ocorrido_em)
                      VALUES ('USUARIO_SALVO','usuario',$1,$2,$3,now())`,
                     [row.id, { perfil_id: d.perfil_id, alcada_max: d.alcada_max, ativo: d.ativo, lojas: d.lojas }, atual.id]);
      return { id: row.id };
    });
  };
  r.post('/api/usuarios', async ({ usuario, body }) => salvarUsuario(exigir(usuario, 'usuario.gerir'), body));
  r.put('/api/usuarios/:id', async ({ usuario, body, params }) => salvarUsuario(exigir(usuario, 'usuario.gerir'), body, params.id));
}
