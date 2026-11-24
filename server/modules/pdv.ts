// PDVs (pontos de venda): cadastro, periféricos vinculados e estado de comunicação.
// A situação (ATIVO / PARADO / INATIVO) é calculada a partir dos equipamentos vinculados; veja db/13_pdv.sql.
import { z } from 'zod';
import { tx } from '../db';
import { exigir } from '../auth';
import { HttpError, validar, type Router } from '../http';
import { registrarEvento } from '../evento';
import { opcional, uuid } from '../validacao';
import { verificarPdv } from '../monitor-pdv';

/** Posições de equipamento no PDV: coluna no banco e rótulo para mensagens. */
export const POSICOES = {
  computador_id: 'Computador', impressora_id: 'Impressora', scanner_id: 'Scanner',
  teclado_id: 'Teclado', gaveta_id: 'Gaveta', balanca_id: 'Balança',
} as const;
type Posicao = keyof typeof POSICOES;
const COLUNAS = Object.keys(POSICOES) as Posicao[];

const pdvSchema = z.object({
  loja_id: uuid,
  numero: z.coerce.number().int().min(1, 'Número do PDV entre 1 e 999').max(999, 'Número do PDV entre 1 e 999'),
  ip: opcional(z.string().ip({ version: 'v4', message: 'IP inválido (ex.: 10.10.5.21)' })),
  ativo: z.boolean().default(true),
  observacao: opcional(z.string().max(500)),
  ...Object.fromEntries(COLUNAS.map(c => [c, opcional(uuid)])) as Record<Posicao, ReturnType<typeof opcional<typeof uuid>>>,
});

// Uma linha por PDV, com os equipamentos vinculados em JSON e a situação calculada
const SELECT_PDV = `
  SELECT p.id, p.loja_id, l.codigo AS loja_codigo, l.nome_fantasia AS loja, p.numero, host(p.ip) AS ip, p.ativo,
         p.observacao, p.atualizado_em, ${COLUNAS.map(c => 'p.' + c).join(', ')},
         per.perifericos,
         CASE WHEN NOT p.ativo THEN 'INATIVO'
              WHEN per.parados > 0 THEN 'PARADO'
              ELSE 'ATIVO' END AS situacao,
         c.online, c.verificado_em, c.ultima_resposta, c.offline_desde, c.latencia_ms,
         c.zabbix_disponivel, c.zabbix_problemas, c.zabbix_verificado_em
    FROM pdv p
    JOIN loja l ON l.id = p.loja_id
    LEFT JOIN pdv_comunicacao c ON c.pdv_id = p.id
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_object_agg(v.posicao, jsonb_build_object(
               'id', e.id, 'descricao', e.descricao, 'modelo', pr.modelo, 'marca', m.nome,
               'numero_serie', e.numero_serie, 'patrimonio', e.patrimonio, 'status', e.status))
               FILTER (WHERE e.id IS NOT NULL), '{}') AS perifericos,
             count(*) FILTER (WHERE e.id IS NOT NULL AND e.status <> 'ATIVO') AS parados
        FROM (VALUES ${COLUNAS.map(c => `('${c}', p.${c})`).join(', ')}) AS v(posicao, equipamento_id)
        LEFT JOIN equipamento e ON e.id = v.equipamento_id
        LEFT JOIN produto pr ON pr.id = e.produto_id
        LEFT JOIN marca m ON m.id = e.marca_id
    ) per`;

export function rotasPdv(r: Router) {
  r.get('/api/pdvs', async ({ usuario, query }) => {
    const u = exigir(usuario);
    const loja = query.get('loja');
    return tx(u.id, db => db.query(
      `${SELECT_PDV} WHERE ($1::uuid IS NULL OR p.loja_id = $1) ORDER BY l.codigo, p.numero`, [loja || null]));
  });

  // Equipamentos da loja que podem ser vinculados (não baixados e fora de outro PDV)
  r.get('/api/pdvs/equipamentos', async ({ usuario, query }) => {
    const u = exigir(usuario, 'equipamento.gerir');
    const loja = validar(uuid, query.get('loja'));
    const pdvId = query.get('pdv');
    return tx(u.id, db => db.query(
      `SELECT e.id, e.descricao, e.numero_serie, e.patrimonio, e.status, host(e.ip) AS ip,
              pr.modelo, pr.descricao AS produto, g.nome AS grupo, m.nome AS marca
         FROM equipamento e
         JOIN produto pr ON pr.id = e.produto_id JOIN grupo_produto g ON g.id = e.grupo_id JOIN marca m ON m.id = e.marca_id
        WHERE e.loja_id = $1 AND e.status NOT IN ('BAIXADO', 'DESCARTADO')
          AND NOT EXISTS (SELECT 1 FROM pdv p WHERE p.id IS DISTINCT FROM $2::uuid
                            AND e.id IN (${COLUNAS.map(c => 'p.' + c).join(', ')}))
        ORDER BY g.nome, pr.descricao, e.numero_serie`, [loja, pdvId || null]));
  });

  const salvar = async (usuarioId: string, body: unknown, id?: string) => {
    const d = validar(pdvSchema, body);
    return tx(usuarioId, async db => {
      // os equipamentos precisam ser da mesma loja do PDV
      const ids = COLUNAS.map(c => d[c]).filter(Boolean) as string[];
      if (ids.length) {
        const fora = await db.query(`SELECT descricao FROM equipamento WHERE id = ANY($1::uuid[]) AND loja_id <> $2`, [ids, d.loja_id]);
        if (fora.length) throw new HttpError(422, `Equipamento de outra loja: ${fora.map((f: any) => f.descricao).join(', ')}`);
      }
      const valores = [d.loja_id, d.numero, d.ip, d.ativo, d.observacao, ...COLUNAS.map(c => d[c])];
      const anterior = id ? await db.one('SELECT * FROM pdv WHERE id = $1', [id]) : null;
      if (id && !anterior) throw new HttpError(404, 'PDV não encontrado');
      const row = id
        ? await db.one(`UPDATE pdv SET loja_id=$2, numero=$3, ip=$4, ativo=$5, observacao=$6,
                          ${COLUNAS.map((c, i) => `${c}=$${i + 7}`).join(', ')}
                        WHERE id = $1 RETURNING id`, [id, ...valores])
        : await db.one(`INSERT INTO pdv (loja_id, numero, ip, ativo, observacao, ${COLUNAS.join(', ')})
                        VALUES (${valores.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`, valores);
      // IP mudou ou PDV inativado: a comunicação anterior não vale mais
      if (anterior && (anterior.ip !== d.ip || !d.ativo)) {
        await db.query(`UPDATE pdv_comunicacao SET online = NULL, verificado_em = NULL, offline_desde = NULL,
                          latencia_ms = NULL, zabbix_disponivel = NULL, zabbix_problemas = NULL WHERE pdv_id = $1`, [row.id]);
      }
      await registrarEvento(db, { tipo: id ? 'PDV_ALTERADO' : 'PDV_CRIADO', entidade: 'pdv', entidadeId: row.id,
                                  payload: id ? { anterior, novo: d } : d, usuarioId });
      return { id: row.id };
    }).catch(e => {
      if (e?.code === '23505' && String(e.constraint).includes('numero')) throw new HttpError(409, `Já existe o PDV ${d.numero} nesta loja`);
      if (e?.code === '23505' && String(e.constraint).includes('ip')) throw new HttpError(409, `O IP ${d.ip} já está em outro PDV ativo`);
      if (e?.code === 'P0001') throw new HttpError(422, e.message);
      throw e;
    });
  };
  r.post('/api/pdvs', async ({ usuario, body }) => salvar(exigir(usuario, 'equipamento.gerir').id, body));
  r.put('/api/pdvs/:id', async ({ usuario, body, params }) => salvar(exigir(usuario, 'equipamento.gerir').id, body, params.id));

  // Testa a comunicação agora (sem esperar o próximo ciclo do monitor)
  r.post('/api/pdvs/:id/verificar', async ({ usuario, params }) => {
    const u = exigir(usuario);
    const p = await tx(u.id, db => db.one(`SELECT id, host(ip) AS ip, ativo FROM pdv WHERE id = $1`, [params.id]));
    if (!p) throw new HttpError(404, 'PDV não encontrado');
    if (!p.ip) throw new HttpError(422, 'PDV sem IP cadastrado');
    await verificarPdv({ id: p.id, ip: p.ip });
    return tx(u.id, db => db.one(`${SELECT_PDV} WHERE p.id = $1`, [p.id]));
  });
}
