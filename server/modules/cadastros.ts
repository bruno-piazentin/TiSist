// Cadastros mestres com CRUD genérico. Não há exclusão física: "Excluir" inativa o registro (some das listas e não
// pode ser escolhido em cadastros novos), preservando histórico, relatórios e movimentações (db/15_cadastro_inativo.sql).
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { tx } from '../db';
import { exigir, type Permissao } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { registrarEvento } from '../evento';
import { podeAlterarGrupo } from './configuracao';
import { opcional, uuid } from '../validacao';

// Número com valor padrão: campo vazio/nulo usa o padrão (z.coerce transformaria null em 0)
const numPadrao = (padrao: number) => z.preprocess(v => (v === null || v === '' ? undefined : v), z.coerce.number().int().min(0).default(padrao));
const email = z.string().trim().email('E-mail inválido');
const cnpj = z.string().transform(s => s.replace(/\D/g, '')).refine(s => s.length === 14, 'CNPJ deve ter 14 dígitos');

/** Onde o registro é usado: mostrado ao excluir; "bloqueia" impede a exclusão enquanto houver ocorrências. */
interface Uso { rotulo: string; sql: string; bloqueia?: boolean }

interface Entidade {
  tabela: string;
  permissao: Permissao;
  schema: ZodObject<ZodRawShape>;
  ordem: string;
  depois?: (db: any, id: string, dados: any) => Promise<void>;
  ativo: string;      // coluna de situação ("Excluir" = inativar)
  nome: string;       // coluna exibida nas mensagens
  uso: Uso[];         // consultas com $1 = id do registro, devolvem count(*)
}

const EQUIP_EM_USO = "status NOT IN ('BAIXADO','DESCARTADO')";
// Equipamento em trânsito cujo último envio tem este destino ($2 = coluna de destino)
const emTransitoPara = (coluna: string) => `SELECT count(*) FROM equipamento e WHERE e.status = 'TRANSITO'
  AND (SELECT m.${coluna} FROM movimentacao m WHERE m.equipamento_id = e.id ORDER BY m.ocorrido_em DESC, m.registrado_em DESC LIMIT 1) = $1`;

const ENTIDADES: Record<string, Entidade> = {
  lojas: {
    tabela: 'loja', permissao: 'cadastro.gerir', ordem: 'codigo',
    schema: z.object({
      codigo: z.string().min(1).max(10), nome_fantasia: z.string().min(2), razao_social: z.string().min(2), cnpj,
      tipo: z.enum(['HIPERMERCADO', 'SUPERMERCADO', 'ATACAREJO', 'CONVENIENCIA', 'CD', 'ESCRITORIO']),
      area_m2: opcional(z.coerce.number().positive()), qtd_checkouts: opcional(z.coerce.number().int().min(0)),
      situacao: z.enum(['ATIVA', 'EM_IMPLANTACAO', 'FECHADA']).default('ATIVA'), critica: z.boolean().default(false),
      endereco: opcional(z.record(z.any())), erp_id: opcional(z.string()),
    }),
    ativo: 'ativo', nome: 'nome_fantasia',
    uso: [
      { rotulo: 'equipamento(s) da loja ou nela (não baixados)', bloqueia: true,
        sql: `SELECT count(*) FROM equipamento WHERE (loja_id = $1 OR local_loja_id = $1) AND ${EQUIP_EM_USO}` },
      { rotulo: 'equipamento(s) em trânsito para a loja', bloqueia: true, sql: emTransitoPara('loja_destino_id') },
      { rotulo: 'PDV(s) ativo(s)', bloqueia: true, sql: 'SELECT count(*) FROM pdv WHERE loja_id = $1 AND ativo' },
      { rotulo: 'usuário(s) com acesso à loja (perdem o acesso a ela)', sql: 'SELECT count(*) FROM usuario_loja ul JOIN usuario u ON u.id = ul.usuario_id WHERE ul.loja_id = $1 AND u.ativo' },
    ],
  },
  departamentos: {
    tabela: 'departamento', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({ codigo: z.string().min(1).max(10), nome: z.string().min(2), centro_custo: z.string().min(1) }),
    ativo: 'ativo', nome: 'nome',
    uso: [
      { rotulo: 'equipamento(s) neste departamento (continuam nele; não pode ser escolhido para outros)', sql: `SELECT count(*) FROM equipamento WHERE departamento_id = $1 AND ${EQUIP_EM_USO}` },
      { rotulo: 'usuário(s) neste departamento', sql: 'SELECT count(*) FROM usuario WHERE departamento_id = $1 AND ativo' },
    ],
  },
  grupos: {
    tabela: 'grupo_produto', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({
      codigo: z.string().min(1).max(10), nome: z.string().min(2), grupo_pai_id: opcional(uuid),
      vida_util_meses: opcional(z.coerce.number().int().positive()), taxa_depreciacao: opcional(z.coerce.number().min(0).max(100)),
    }),
    ativo: 'ativo', nome: 'nome',
    uso: [
      { rotulo: 'modelo(s) ativo(s) do grupo', sql: 'SELECT count(*) FROM produto WHERE grupo_id = $1 AND ativo_catalogo' },
      { rotulo: 'equipamento(s) do grupo (não baixados)', sql: `SELECT count(*) FROM equipamento WHERE grupo_id = $1 AND ${EQUIP_EM_USO}` },
      { rotulo: 'subgrupo(s) ativo(s)', sql: 'SELECT count(*) FROM grupo_produto WHERE grupo_pai_id = $1 AND ativo' },
      { rotulo: 'categoria(s) de falha ativa(s) do grupo', sql: 'SELECT count(*) FROM categoria_falha WHERE grupo_id = $1 AND ativo' },
    ],
  },
  marcas: {
    tabela: 'marca', permissao: 'cadastro.gerir', ordem: 'nome', schema: z.object({ nome: z.string().min(1) }),
    ativo: 'ativo', nome: 'nome',
    uso: [{ rotulo: 'modelo(s) ativo(s) da marca', sql: 'SELECT count(*) FROM produto WHERE marca_id = $1 AND ativo_catalogo' }],
  },
  fabricantes: {
    tabela: 'fabricante', permissao: 'cadastro.gerir', ordem: 'razao_social',
    schema: z.object({ razao_social: z.string().min(2), cnpj: opcional(cnpj), canal_garantia: opcional(z.record(z.any())), marcas: z.array(uuid).default([]) }),
    // vínculo marca x fabricante (uma marca pode ter vários fabricantes)
    depois: async (db, id, d) => {
      if (d.marcas?.length) await db.query('INSERT INTO marca_fabricante SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING', [d.marcas, id]);
    },
    ativo: 'ativo', nome: 'razao_social',
    uso: [{ rotulo: 'modelo(s) ativo(s) do fabricante', sql: 'SELECT count(*) FROM produto WHERE fabricante_id = $1 AND ativo_catalogo' }],
  },
  produtos: {
    tabela: 'produto', permissao: 'cadastro.gerir', ordem: 'modelo',
    schema: z.object({
      descricao: z.string().min(2), modelo: z.string().min(1), marca_id: uuid, fabricante_id: uuid, grupo_id: uuid,
      sku_fabricante: opcional(z.string()), cor_padrao: opcional(z.string()), especificacoes: opcional(z.record(z.any())),
      vida_util_meses: opcional(z.coerce.number().int().positive()), garantia_meses: numPadrao(12),
    }),
    ativo: 'ativo_catalogo', nome: 'modelo',
    uso: [{ rotulo: 'equipamento(s) deste modelo (não baixados; continuam funcionando)', sql: `SELECT count(*) FROM equipamento WHERE produto_id = $1 AND ${EQUIP_EM_USO}` }],
  },
  fornecedores: {
    tabela: 'fornecedor', permissao: 'fornecedor.gerir', ordem: 'razao_social',
    schema: z.object({
      razao_social: z.string().min(2), cnpj, tipos: z.array(z.enum(['ASSISTENCIA', 'PECAS', 'FABRICANTE', 'TRANSPORTADORA'])).min(1),
      contato: opcional(z.record(z.any())), sla_orcamento_dias: opcional(z.coerce.number().int().positive()),
      sla_reparo_dias: opcional(z.coerce.number().int().positive()), garantia_servico_dias: numPadrao(90),
      regioes: opcional(z.array(z.string())), homologado: z.boolean().default(false), suspenso_motivo: opcional(z.string()),
      // dados complementares (06_fornecedor_detalhes.sql)
      nome_fantasia: opcional(z.string().trim()), telefone: opcional(z.string().trim()), email: opcional(email),
      cep: opcional(z.string().transform(s => s.replace(/\D/g, '')).refine(s => s.length === 8, 'CEP deve ter 8 dígitos')),
      logradouro: opcional(z.string().trim()), numero: opcional(z.string().trim()), complemento: opcional(z.string().trim()),
      bairro: opcional(z.string().trim()), cidade: opcional(z.string().trim()),
      uf: opcional(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras')),
      assistencia_nome: opcional(z.string().trim()), assistencia_telefone: opcional(z.string().trim()), assistencia_email: opcional(email),
      vendedor_nome: opcional(z.string().trim()), vendedor_telefone: opcional(z.string().trim()), vendedor_email: opcional(email),
      marcas_representadas: z.array(uuid).default([]),
    }),
    ativo: 'ativo', nome: 'razao_social',
    uso: [
      { rotulo: 'equipamento(s) no fornecedor', bloqueia: true, sql: `SELECT count(*) FROM equipamento WHERE local_fornecedor_id = $1 AND ${EQUIP_EM_USO}` },
      { rotulo: 'equipamento(s) em trânsito para o fornecedor', bloqueia: true, sql: emTransitoPara('fornecedor_destino_id') },
      { rotulo: 'chamado(s) em aberto com o fornecedor', bloqueia: true, sql: `SELECT count(*) FROM chamado WHERE fornecedor_id = $1 AND situacao NOT IN ('ENCERRADO','CANCELADO')` },
      { rotulo: 'orçamento(s) em andamento', bloqueia: true, sql: `SELECT count(*) FROM orcamento WHERE fornecedor_id = $1 AND status IN ('RASCUNHO','SOLICITADO','RECEBIDO','EM_ANALISE')` },
    ],
  },
  servicos: {
    tabela: 'servico', permissao: 'cadastro.gerir', ordem: 'descricao',
    schema: z.object({
      tipo: z.enum(['DIAGNOSTICO', 'REPARO', 'TROCA_PECA', 'INSTALACAO', 'PREVENTIVA', 'CALIBRACAO', 'DESCARTE']),
      descricao: z.string().min(2), unidade_cobranca: z.enum(['HORA', 'EVENTO']),
      valor_referencia: opcional(z.coerce.number().min(0)), sla_dias: opcional(z.coerce.number().int().positive()),
    }),
    ativo: 'ativo', nome: 'descricao',
    uso: [{ rotulo: 'orçamento(s) em andamento com este serviço', sql: `SELECT count(DISTINCT o.id) FROM orcamento_item i JOIN orcamento o ON o.id = i.orcamento_id
                                                                      WHERE i.servico_id = $1 AND o.status IN ('RASCUNHO','SOLICITADO','RECEBIDO','EM_ANALISE')` }],
  },
  categorias: {
    tabela: 'categoria_falha', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({ codigo: z.string().min(2).max(20), nome: z.string().min(2), grupo_id: opcional(uuid) }),
    ativo: 'ativo', nome: 'nome',
    uso: [{ rotulo: 'chamado(s) em aberto com esta categoria', sql: `SELECT count(*) FROM chamado WHERE (categoria_falha_relatada_id = $1 OR categoria_falha_id = $1)
                                                                  AND situacao NOT IN ('ENCERRADO','CANCELADO')` }],
  },
};

function entidade(nome: string): Entidade {
  const e = ENTIDADES[nome];
  if (!e) throw new HttpError(404, 'Cadastro inexistente');
  return e;
}

// Monta INSERT/UPDATE só com colunas do schema (nomes vêm do código, nunca do usuário)
function colunas(e: Entidade, dados: Record<string, unknown>) {
  return Object.keys(e.schema.shape).filter(c => c in dados && c !== 'marcas');
}

export function rotasCadastros(r: Router) {
  r.get('/api/cadastros/:entidade', async ({ usuario, params }) => {
    const u = exigir(usuario);
    const e = entidade(params.entidade);
    return tx(u.id, db => db.query(`SELECT * FROM ${e.tabela} ORDER BY ${e.ordem}`));
  });

  r.post('/api/cadastros/:entidade', async ({ usuario, params, body }) => {
    const e = entidade(params.entidade);
    const u = exigir(usuario, e.permissao);
    const d = validar(e.schema, body) as Record<string, unknown>;
    const cols = colunas(e, d);
    return tx(u.id, async db => {
      const row = await db.one(
        `INSERT INTO ${e.tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`,
        cols.map(c => d[c]));
      await e.depois?.(db, row.id, d);
      await registrarEvento(db, { tipo: 'CADASTRO_CRIADO', entidade: e.tabela, entidadeId: row.id, payload: d, usuarioId: u.id });
      return row;
    });
  });

  r.put('/api/cadastros/:entidade/:id', async ({ usuario, params, body }) => {
    const e = entidade(params.entidade);
    const u = exigir(usuario, e.permissao);
    const d = validar(e.schema.partial(), body) as Record<string, unknown>;
    const cols = colunas(e, d);
    return tx(u.id, async db => {
      const antes = await db.one(`SELECT * FROM ${e.tabela} WHERE id = $1`, [params.id]);
      if (!antes) throw new HttpError(404, 'Registro não encontrado');
      if (cols.length) {
        await db.query(`UPDATE ${e.tabela} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
                       [params.id, ...cols.map(c => d[c])]);
      }
      await e.depois?.(db, params.id, d);
      // auditoria: valor anterior e novo
      const anterior = Object.fromEntries(cols.map(c => [c, antes[c]]));
      await registrarEvento(db, { tipo: 'CADASTRO_ALTERADO', entidade: e.tabela, entidadeId: params.id, payload: { anterior, novo: d }, usuarioId: u.id });
      return { id: params.id };
    });
  });

  // ---------------- Excluir = inativar ----------------
  const usoDo = async (db: any, e: Entidade, id: string) => {
    const r: { rotulo: string; bloqueia: boolean; qtd: number }[] = [];
    for (const x of e.uso) r.push({ rotulo: x.rotulo, bloqueia: !!x.bloqueia, qtd: Number((await db.one(x.sql, [id])).count) });
    return r.filter(x => x.qtd > 0);
  };

  // Onde o registro é usado (a tela mostra antes de confirmar a exclusão)
  r.get('/api/cadastros/:entidade/:id/uso', async ({ usuario, params }) => {
    const e = entidade(params.entidade);
    const u = exigir(usuario, e.permissao);
    return tx(u.id, db => usoDo(db, e, params.id));
  });

  const mudarSituacao = (ativar: boolean) => async ({ usuario, params }: any) => {
    const e = entidade(params.entidade);
    const u = exigir(usuario, e.permissao);
    return tx(u.id, async db => {
      const reg = await db.one(`SELECT ${e.ativo} AS ativo, ${e.nome}::text AS nome FROM ${e.tabela} WHERE id = $1 FOR UPDATE`, [params.id]);
      if (!reg) throw new HttpError(404, 'Registro não encontrado');
      if (reg.ativo === ativar) return { ok: true, sem_mudanca: true };
      if (!ativar) {
        const impede = (await usoDo(db, e, params.id)).filter(x => x.bloqueia);
        if (impede.length) {
          throw new HttpError(409, `"${reg.nome}" não pode ser excluído enquanto houver: ${impede.map(x => `${x.qtd} ${x.rotulo}`).join('; ')}.`, impede);
        }
      }
      await db.query(`UPDATE ${e.tabela} SET ${e.ativo} = $2 WHERE id = $1`, [params.id, ativar]);
      await registrarEvento(db, { tipo: ativar ? 'CADASTRO_REATIVADO' : 'CADASTRO_INATIVADO', entidade: e.tabela, entidadeId: params.id,
                                  payload: { nome: reg.nome }, usuarioId: u.id });
      return { ok: true };
    });
  };
  r.post('/api/cadastros/:entidade/:id/inativar', mudarSituacao(false));
  r.post('/api/cadastros/:entidade/:id/reativar', mudarSituacao(true));

  // Parâmetros configuráveis (janelas, percentuais, prazos)
  r.put('/api/parametros/:chave', async ({ usuario, params, body }) => {
    const u = exigir(usuario);
    const { valor } = validar(z.object({ valor: z.coerce.number().min(0, 'O valor não pode ser negativo') }), body);
    return tx(u.id, async db => {
      const antes = await db.one('SELECT valor, grupo FROM parametro WHERE chave = $1 FOR UPDATE', [params.chave]);
      if (!antes) throw new HttpError(404, 'Parâmetro inexistente');
      if (!podeAlterarGrupo(u, antes.grupo)) throw new HttpError(403, 'Seu usuário não pode alterar este grupo de parâmetros');
      await db.query('UPDATE parametro SET valor = $2 WHERE chave = $1', [params.chave, valor]);
      await registrarEvento(db, { tipo: 'PARAMETRO_ALTERADO', entidade: 'parametro',
                                  payload: { chave: params.chave, grupo: antes.grupo, anterior: antes.valor, novo: valor }, usuarioId: u.id });
      return { ok: true };
    });
  });
}
