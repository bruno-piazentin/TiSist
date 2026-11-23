// Agenda: agendamentos de visitas técnicas, preventivas, instalações, coletas/entregas e reuniões.
import { z } from 'zod';
import { tx } from '../db';
import { exigir } from '../auth';
import { HttpError, validar, type Router } from '../http';

const uuid = z.string().uuid();
const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform(v => (v === '' ? null : v ?? null));
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const hora = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (HH:MM)');
const vazioNulo = (v: unknown) => (v === '' ? null : v);

const schema = z.object({
  titulo: z.string().trim().min(3, 'Informe o título'),
  tipo: z.enum(['VISITA_TECNICA', 'PREVENTIVA', 'INSTALACAO', 'COLETA_ENTREGA', 'REUNIAO', 'OUTRO']),
  data: dia,
  hora_inicio: z.preprocess(vazioNulo, hora.nullish()).transform(v => v ?? null),
  hora_fim: z.preprocess(vazioNulo, hora.nullish()).transform(v => v ?? null),
  loja_id: z.preprocess(vazioNulo, opcional(uuid)),
  fornecedor_id: z.preprocess(vazioNulo, opcional(uuid)),
  responsavel_id: z.preprocess(vazioNulo, opcional(uuid)),
  chamado_numero: z.preprocess(vazioNulo, z.coerce.number().int().positive().nullish()).transform(v => v ?? null),
  descricao: z.preprocess(vazioNulo, opcional(z.string().trim())),
  situacao: z.enum(['AGENDADO', 'CONCLUIDO', 'CANCELADO']).default('AGENDADO'),
}).refine(d => !d.hora_inicio || !d.hora_fim || d.hora_fim > d.hora_inicio, { message: 'Hora final deve ser depois da inicial', path: ['hora_fim'] });

const SELECT = `
  SELECT a.id, a.titulo, a.tipo, to_char(a.data, 'YYYY-MM-DD') AS data,
         to_char(a.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(a.hora_fim, 'HH24:MI') AS hora_fim,
         a.loja_id, l.codigo AS loja_codigo, l.nome_fantasia AS loja_nome,
         a.fornecedor_id, f.razao_social AS fornecedor,
         a.chamado_id, c.numero AS chamado_numero,
         a.responsavel_id, r.nome AS responsavel, a.descricao, a.situacao,
         cr.nome AS criado_por, a.criado_em
    FROM agendamento a
    LEFT JOIN loja l ON l.id = a.loja_id
    LEFT JOIN fornecedor f ON f.id = a.fornecedor_id
    LEFT JOIN chamado c ON c.id = a.chamado_id
    LEFT JOIN usuario r ON r.id = a.responsavel_id
    JOIN usuario cr ON cr.id = a.criado_por`;

/** Converte o nº do chamado (visível ao usuário pelo RLS) em id. */
async function chamadoId(db: any, numero: number | null) {
  if (!numero) return null;
  const c = await db.one('SELECT id FROM chamado WHERE numero = $1', [numero]);
  if (!c) throw new HttpError(422, `Chamado nº ${numero} não encontrado`);
  return c.id;
}

export function rotasAgenda(r: Router) {
  // Agendamentos de um período (o calendário pede o mês exibido)
  r.get('/api/agenda', async ({ usuario, query }) => {
    const u = exigir(usuario);
    const { de, ate } = validar(z.object({ de: dia, ate: dia }), Object.fromEntries(query));
    return tx(u.id, db => db.query(`${SELECT} WHERE a.data BETWEEN $1 AND $2
      ORDER BY a.data, a.hora_inicio NULLS FIRST, a.titulo`, [de, ate]));
  });

  // Pessoas que podem ser responsáveis por um agendamento (equipe de TI ativa)
  r.get('/api/agenda/responsaveis', async ({ usuario }) => {
    const u = exigir(usuario);
    return tx(u.id, db => db.query(`SELECT u.id, u.nome FROM usuario u JOIN perfil p ON p.id = u.perfil_id
      WHERE u.ativo AND p.codigo IN ('GESTOR_TI','COORDENADOR','TECNICO') ORDER BY u.nome`));
  });

  r.post('/api/agenda', async ({ usuario, body }) => {
    const u = exigir(usuario, 'agenda.gerir');
    const { chamado_numero, ...d } = validar(schema, body);
    return tx(u.id, async db => {
      const chamado_id = await chamadoId(db, chamado_numero);
      const row = await db.one(
        `INSERT INTO agendamento (titulo, tipo, data, hora_inicio, hora_fim, loja_id, fornecedor_id, chamado_id, responsavel_id, descricao, situacao, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [d.titulo, d.tipo, d.data, d.hora_inicio, d.hora_fim, d.loja_id, d.fornecedor_id, chamado_id, d.responsavel_id, d.descricao, d.situacao, u.id]);
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, payload, usuario_id, ocorrido_em)
                      VALUES ('AGENDAMENTO_CRIADO','agendamento',$1,$2,$3,now())`, [row.id, { ...d, chamado_id }, u.id]);
      return row;
    });
  });

  r.put('/api/agenda/:id', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'agenda.gerir');
    const { chamado_numero, ...d } = validar(schema, body);
    return tx(u.id, async db => {
      const antes = await db.one('SELECT * FROM agendamento WHERE id = $1', [params.id]);
      if (!antes) throw new HttpError(404, 'Agendamento não encontrado');
      const chamado_id = await chamadoId(db, chamado_numero);
      await db.query(
        `UPDATE agendamento SET titulo=$2, tipo=$3, data=$4, hora_inicio=$5, hora_fim=$6, loja_id=$7, fornecedor_id=$8,
                chamado_id=$9, responsavel_id=$10, descricao=$11, situacao=$12 WHERE id = $1`,
        [params.id, d.titulo, d.tipo, d.data, d.hora_inicio, d.hora_fim, d.loja_id, d.fornecedor_id, chamado_id, d.responsavel_id, d.descricao, d.situacao]);
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, payload, usuario_id, ocorrido_em)
                      VALUES ('AGENDAMENTO_ALTERADO','agendamento',$1,$2,$3,now())`, [params.id, { anterior: antes, novo: { ...d, chamado_id } }, u.id]);
      return { id: params.id };
    });
  });
}
