// Cadastros mestres com CRUD genérico (sem exclusão: registros saem de uso por situação).
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

interface Entidade {
  tabela: string;
  permissao: Permissao;
  schema: ZodObject<ZodRawShape>;
  ordem: string;
  depois?: (db: any, id: string, dados: any) => Promise<void>;
}

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
  },
  departamentos: {
    tabela: 'departamento', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({ codigo: z.string().min(1).max(10), nome: z.string().min(2), centro_custo: z.string().min(1), ativo: z.boolean().default(true) }),
  },
  grupos: {
    tabela: 'grupo_produto', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({
      codigo: z.string().min(1).max(10), nome: z.string().min(2), grupo_pai_id: opcional(uuid),
      vida_util_meses: opcional(z.coerce.number().int().positive()), taxa_depreciacao: opcional(z.coerce.number().min(0).max(100)),
    }),
  },
  marcas: { tabela: 'marca', permissao: 'cadastro.gerir', ordem: 'nome', schema: z.object({ nome: z.string().min(1) }) },
  fabricantes: {
    tabela: 'fabricante', permissao: 'cadastro.gerir', ordem: 'razao_social',
    schema: z.object({ razao_social: z.string().min(2), cnpj: opcional(cnpj), canal_garantia: opcional(z.record(z.any())), marcas: z.array(uuid).default([]) }),
    // vínculo marca x fabricante (uma marca pode ter vários fabricantes)
    depois: async (db, id, d) => {
      if (d.marcas?.length) await db.query('INSERT INTO marca_fabricante SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING', [d.marcas, id]);
    },
  },
  produtos: {
    tabela: 'produto', permissao: 'cadastro.gerir', ordem: 'modelo',
    schema: z.object({
      descricao: z.string().min(2), modelo: z.string().min(1), marca_id: uuid, fabricante_id: uuid, grupo_id: uuid,
      sku_fabricante: opcional(z.string()), cor_padrao: opcional(z.string()), especificacoes: opcional(z.record(z.any())),
      vida_util_meses: opcional(z.coerce.number().int().positive()), garantia_meses: numPadrao(12),
      ativo_catalogo: z.boolean().default(true),
    }),
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
  },
  servicos: {
    tabela: 'servico', permissao: 'cadastro.gerir', ordem: 'descricao',
    schema: z.object({
      tipo: z.enum(['DIAGNOSTICO', 'REPARO', 'TROCA_PECA', 'INSTALACAO', 'PREVENTIVA', 'CALIBRACAO', 'DESCARTE']),
      descricao: z.string().min(2), unidade_cobranca: z.enum(['HORA', 'EVENTO']),
      valor_referencia: opcional(z.coerce.number().min(0)), sla_dias: opcional(z.coerce.number().int().positive()),
    }),
  },
  categorias: {
    tabela: 'categoria_falha', permissao: 'cadastro.gerir', ordem: 'nome',
    schema: z.object({ codigo: z.string().min(2).max(20), nome: z.string().min(2), grupo_id: opcional(uuid) }),
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
