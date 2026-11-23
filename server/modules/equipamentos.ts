// Equipamentos: cadastro, consulta, histórico, movimentação de status e baixa.
import { z } from 'zod';
import { tx, type Db } from '../db';
import { exigir, pode, type Usuario } from '../auth';
import { enviarCsv, HttpError, validar, type Router } from '../http';

const uuid = z.string().uuid();
const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform(v => (v === '' ? null : v ?? null));

const STATUS = ['ATIVO', 'AGUARDANDO_ORCAMENTO', 'EM_MANUTENCAO', 'TRANSITO', 'EM_ESTOQUE', 'EM_RESERVA', 'SINISTRADO', 'BAIXADO', 'DESCARTADO'] as const;

// Campos editáveis livremente (loja, status e localização só por movimentação)
const camposEditaveis = {
  descricao: z.string().min(2), cor: z.string().min(1), departamento_id: uuid,
  patrimonio: opcional(z.string()), data_aquisicao: opcional(z.string().date()), nota_fiscal: opcional(z.string()),
  valor_aquisicao: opcional(z.coerce.number().min(0)), fornecedor_compra_id: opcional(uuid),
  garantia_inicio: opcional(z.string().date()), garantia_fim: opcional(z.string().date()),
  garantia_tipo: opcional(z.enum(['FABRICA', 'ESTENDIDA', 'CONTRATO'])),
  setor_instalacao: opcional(z.string()), ponto_instalacao: opcional(z.string()),
  ip: opcional(z.string().ip()), mac: opcional(z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, 'MAC inválido')),
  hostname: opcional(z.string().max(63)), firmware_versao: opcional(z.string()), reserva_id: opcional(uuid),
  responsavel_uso: opcional(z.string()),
};
const novoEquipamento = z.object({
  ...camposEditaveis,
  numero_serie: opcional(z.string().trim()),   // vazio = código interno gerado
  produto_id: uuid, loja_id: uuid,
  status: z.enum(['ATIVO', 'EM_ESTOQUE', 'EM_RESERVA']).default('ATIVO'),
  confirmar_serie_outro_modelo: z.boolean().default(false),
});

export const movimentoSchema = z.object({
  id: uuid,                                     // UUID gerado no aparelho (idempotência)
  status_novo: z.enum(STATUS),
  motivo: opcional(z.string()),
  destino_tipo: opcional(z.enum(['LOJA', 'CD', 'FORNECEDOR'])),
  loja_destino_id: opcional(uuid),
  fornecedor_destino_id: opcional(uuid),
  documento: opcional(z.string()),
  chamado_id: opcional(uuid),
  orcamento_id: opcional(uuid),
  confirmou_receb: z.boolean().default(false),
  teste_ok: z.boolean().nullish(),
  ocorrido_em: z.string().datetime({ offset: true }).optional(),
});
export type Movimento = z.infer<typeof movimentoSchema>;

const SELECT_EQUIP = `
  SELECT e.*, p.modelo, p.descricao AS produto_descricao, m.nome AS marca, f.razao_social AS fabricante,
         g.nome AS grupo, d.nome AS departamento, l.codigo AS loja_codigo, l.nome_fantasia AS loja,
         ll.nome_fantasia AS local_loja, fl.razao_social AS local_fornecedor,
         (e.garantia_fim IS NOT NULL AND e.garantia_fim >= current_date) AS em_garantia,
         (SELECT max(ocorrido_em) FROM movimentacao mv WHERE mv.equipamento_id = e.id) AS ultima_movimentacao
    FROM equipamento e
    JOIN produto p ON p.id = e.produto_id JOIN marca m ON m.id = e.marca_id
    JOIN fabricante f ON f.id = e.fabricante_id JOIN grupo_produto g ON g.id = e.grupo_id
    JOIN departamento d ON d.id = e.departamento_id JOIN loja l ON l.id = e.loja_id
    LEFT JOIN loja ll ON ll.id = e.local_loja_id LEFT JOIN fornecedor fl ON fl.id = e.local_fornecedor_id`;

/** Executa uma movimentação pela função do banco, com as restrições de perfil da aplicação. */
export async function movimentar(db: Db, u: Usuario, equipamentoId: string, m: Movimento) {
  if (!pode(u, 'movimentar')) throw new HttpError(403, 'Seu perfil não movimenta equipamentos');
  // Idempotência: reenvio da mesma operação (fila offline) devolve o resultado anterior
  if (await db.one('SELECT 1 FROM movimentacao WHERE id = $1', [m.id])) return { id: m.id, duplicado: true };
  // Gerente de loja: apenas confirmar retorno (Ativo); abertura de chamado passa pelo módulo de chamados
  if (u.perfil === 'GERENTE_LOJA') {
    const atual = (await db.one('SELECT status FROM equipamento WHERE id = $1', [equipamentoId]))?.status;
    const permitido = (m.status_novo === 'AGUARDANDO_ORCAMENTO' && atual === 'ATIVO')
                   || (m.status_novo === 'ATIVO' && ['TRANSITO', 'EM_MANUTENCAO'].includes(atual));
    if (!permitido) throw new HttpError(403, 'Gerente de loja só confirma recebimento e teste do equipamento que retorna');
  }
  if (m.status_novo === 'BAIXADO' || m.status_novo === 'DESCARTADO') {
    throw new HttpError(422, 'Baixa e descarte exigem solicitação e aprovação (use "Solicitar baixa")');
  }
  const statusAnterior = (await db.one('SELECT status FROM equipamento WHERE id = $1', [equipamentoId]))?.status;
  const r = await db.one(
    `SELECT fn_movimentar($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS id`,
    [m.id, equipamentoId, m.status_novo, u.id, m.ocorrido_em ?? new Date().toISOString(), m.motivo,
     m.destino_tipo, m.loja_destino_id, m.fornecedor_destino_id, m.documento, m.chamado_id, m.orcamento_id,
     m.confirmou_receb, m.teste_ok ?? null]);
  // Datas do chamado acompanham o fluxo físico
  if (m.chamado_id) {
    const quando = m.ocorrido_em ?? new Date().toISOString();
    if (m.status_novo === 'TRANSITO' && m.destino_tipo === 'FORNECEDOR')
      await db.query('UPDATE chamado SET enviado_em = coalesce(enviado_em, $2) WHERE id = $1', [m.chamado_id, quando]);
    if (m.status_novo === 'EM_MANUTENCAO' && m.confirmou_receb)
      await db.query(`UPDATE chamado SET recebido_fornecedor_em = coalesce(recebido_fornecedor_em, $2),
                        reparo_inicio_em = coalesce(reparo_inicio_em, $2), situacao = 'EM_REPARO' WHERE id = $1`, [m.chamado_id, quando]);
    // Retorno à loja só após manutenção (saída para diagnóstico não é retorno)
    if (m.status_novo === 'TRANSITO' && m.destino_tipo === 'LOJA' && statusAnterior === 'EM_MANUTENCAO')
      await db.query(`UPDATE chamado SET reparo_fim_em = coalesce(reparo_fim_em, $2), situacao = 'EM_RETORNO' WHERE id = $1`, [m.chamado_id, quando]);
    if (m.status_novo === 'ATIVO')
      await db.query(`UPDATE chamado SET retorno_loja_em = $2, teste_ok = $3, reparo_fim_em = coalesce(reparo_fim_em, $2) WHERE id = $1`,
                     [m.chamado_id, quando, m.teste_ok ?? null]);
  }
  return r;
}

export function rotasEquipamentos(r: Router) {
  r.get('/api/equipamentos', async (ctx) => {
    const u = exigir(ctx.usuario);
    const q = ctx.query;
    const filtros: string[] = [];
    const p: unknown[] = [];
    const add = (cond: string, v: unknown) => { p.push(v); filtros.push(cond.replace('?', '$' + p.length)); };
    if (q.get('q')) add(`(e.descricao ILIKE ? OR e.numero_serie ILIKE $${p.length + 1} OR e.patrimonio ILIKE $${p.length + 1} OR p.modelo ILIKE $${p.length + 1} OR e.ponto_instalacao ILIKE $${p.length + 1})`, `%${q.get('q')}%`);
    if (q.get('loja')) add('e.loja_id = ?', q.get('loja'));
    if (q.get('status')) add('e.status = ANY(?::status_equipamento[])', q.get('status')!.split(','));
    if (q.get('produto')) add('e.produto_id = ?', q.get('produto'));
    if (q.get('grupo')) add('e.grupo_id = ?', q.get('grupo'));
    if (q.get('departamento')) add('e.departamento_id = ?', q.get('departamento'));
    const limite = Math.min(Number(q.get('limit') || 200), q.get('format') === 'csv' ? 50000 : 2000);
    const sql = `${SELECT_EQUIP} ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
                 ORDER BY l.codigo, e.descricao LIMIT ${limite} OFFSET ${Number(q.get('offset') || 0)}`;
    const linhas = await tx(u.id, db => db.query(sql, p));
    if (q.get('format') === 'csv') {
      enviarCsv(ctx.res, 'equipamentos', linhas.map((e: any) => ({
        loja: e.loja_codigo, descricao: e.descricao, numero_serie: e.numero_serie, patrimonio: e.patrimonio,
        modelo: e.modelo, marca: e.marca, grupo: e.grupo, departamento: e.departamento, status: e.status,
        local: e.local_fornecedor || e.local_loja, ponto: e.ponto_instalacao, garantia_fim: e.garantia_fim, valor_aquisicao: e.valor_aquisicao,
      })));
      return undefined;
    }
    return linhas;
  });

  // Leitura de QR code / patrimônio / série
  r.get('/api/equipamentos/busca/:codigo', async ({ usuario, params }) => {
    const u = exigir(usuario);
    const e = await tx(u.id, db => db.one(`${SELECT_EQUIP} WHERE e.qr_code = $1 OR e.patrimonio = $1 OR e.numero_serie = $1 LIMIT 1`, [params.codigo]));
    if (!e) throw new HttpError(404, 'Equipamento não encontrado');
    return e;
  });

  r.get('/api/equipamentos/:id', async ({ usuario, params }) => {
    const u = exigir(usuario);
    return tx(u.id, async db => {
      const e = await db.one(`${SELECT_EQUIP} WHERE e.id = $1`, [params.id]);
      if (!e) throw new HttpError(404, 'Equipamento não encontrado ou sem acesso');
      const [custo, chamadoAberto, transicoes, baixaPendente, chamados] = await Promise.all([
        db.one('SELECT custo_acumulado, custo_pecas, custo_mao_obra, custo_logistica, pct_aquisicao, sugerir_substituicao FROM vw_custo_equipamento WHERE id = $1', [params.id]),
        db.one(`SELECT id, numero, tipo, situacao, prioridade FROM chamado WHERE equipamento_id = $1
                  AND situacao NOT IN ('ENCERRADO','CANCELADO') ORDER BY aberto_em DESC LIMIT 1`, [params.id]),
        db.query('SELECT * FROM transicao_status WHERE de = $1 AND para NOT IN (\'BAIXADO\',\'DESCARTADO\')', [e.status]),
        db.one(`SELECT id, tipo, motivo, criado_em FROM solicitacao_baixa WHERE equipamento_id = $1 AND situacao = 'PENDENTE'`, [params.id]),
        db.query(`SELECT count(*) AS total, count(*) FILTER (WHERE reincidente) AS reincidentes FROM chamado
                   WHERE equipamento_id = $1 AND situacao <> 'CANCELADO'`, [params.id]),
      ]);
      return { ...e, custo, chamado_aberto: chamadoAberto ?? null, transicoes, baixa_pendente: baixaPendente ?? null, resumo_chamados: chamados[0] };
    });
  });

  r.get('/api/equipamentos/:id/historico', async ({ usuario, params }) => {
    const u = exigir(usuario);
    return tx(u.id, db => db.query(
      `SELECT ev.id, ev.tipo, ev.payload, ev.ocorrido_em, ev.registrado_em, us.nome AS usuario
         FROM evento ev LEFT JOIN usuario us ON us.id = ev.usuario_id
        WHERE ev.equipamento_id = $1 ORDER BY ev.ocorrido_em DESC, ev.id DESC`, [params.id]));
  });

  r.post('/api/equipamentos', async ({ usuario, body }) => {
    const u = exigir(usuario, 'equipamento.gerir');
    const d = validar(novoEquipamento, body);
    return tx(u.id, async db => {
      const prod = await db.one('SELECT id, marca_id, fabricante_id, grupo_id, ativo_catalogo, garantia_meses FROM produto WHERE id = $1', [d.produto_id]);
      if (!prod) throw new HttpError(422, 'Modelo inexistente');
      if (!prod.ativo_catalogo) throw new HttpError(422, 'Modelo descontinuado não aceita equipamento novo');
      let serie = d.numero_serie;
      let gerada = false;
      if (!serie) { serie = 'INT-' + String((await db.one("SELECT nextval('seq_codigo_interno') AS n")).n).padStart(6, '0'); gerada = true; }
      // Série igual em outro modelo: avisa e exige confirmação (no mesmo modelo, o banco bloqueia)
      const outro = await db.one('SELECT e.id, p.modelo FROM equipamento e JOIN produto p ON p.id = e.produto_id WHERE e.numero_serie = $1 AND e.produto_id <> $2', [serie, d.produto_id]);
      if (outro && !d.confirmar_serie_outro_modelo) {
        throw new HttpError(409, `Série já cadastrada no modelo ${outro.modelo}. Confirme para continuar.`, { codigo: 'SERIE_OUTRO_MODELO' });
      }
      // Garantia sugerida = aquisição + garantia padrão do modelo
      const garantiaInicio = d.garantia_inicio ?? d.data_aquisicao;
      let garantiaFim = d.garantia_fim;
      if (!garantiaFim && garantiaInicio) {
        garantiaFim = (await db.one(`SELECT ($1::date + make_interval(months => $2))::date AS f`, [garantiaInicio, prod.garantia_meses])).f;
      }
      const row = await db.one(
        `INSERT INTO equipamento (descricao, numero_serie, serie_gerada, produto_id, marca_id, fabricante_id, grupo_id, cor,
            departamento_id, loja_id, status, local_tipo, local_loja_id, patrimonio, data_aquisicao, nota_fiscal, valor_aquisicao,
            fornecedor_compra_id, garantia_inicio, garantia_fim, garantia_tipo, setor_instalacao, ponto_instalacao, ip, mac,
            hostname, firmware_versao, reserva_id, responsavel_uso)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 (SELECT CASE WHEN tipo = 'CD' THEN 'CD' ELSE 'LOJA' END::tipo_local FROM loja WHERE id = $10), $10,
                 $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING id, numero_serie, qr_code`,
        [d.descricao, serie, gerada, prod.id, prod.marca_id, prod.fabricante_id, prod.grupo_id, d.cor, d.departamento_id, d.loja_id,
         d.status, d.patrimonio, d.data_aquisicao, d.nota_fiscal, d.valor_aquisicao, d.fornecedor_compra_id, garantiaInicio ?? null,
         garantiaFim ?? null, d.garantia_tipo ?? (garantiaFim ? 'FABRICA' : null), d.setor_instalacao, d.ponto_instalacao, d.ip, d.mac,
         d.hostname, d.firmware_versao, d.reserva_id, d.responsavel_uso]);
      await db.query(`INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
                      VALUES ('EQUIPAMENTO_CADASTRADO','equipamento',$1,$1,$2,$3,now())`, [row.id, { ...d, numero_serie: serie }, u.id]);
      return row;
    });
  });

  r.put('/api/equipamentos/:id', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'equipamento.gerir');
    const d = validar(z.object(camposEditaveis).partial(), body) as Record<string, unknown>;
    const cols = Object.keys(camposEditaveis).filter(c => c in d);
    if (!cols.length) return { id: params.id };
    return tx(u.id, async db => {
      const r2 = await db.query(`UPDATE equipamento SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
                                [params.id, ...cols.map(c => d[c])]);
      if (!r2.length) throw new HttpError(404, 'Equipamento não encontrado ou sem acesso');
      return { id: params.id };
    });
  });

  r.post('/api/equipamentos/:id/movimentar', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'movimentar');
    const m = validar(movimentoSchema, body);
    return tx(u.id, db => movimentar(db, u, params.id, m));
  });

  // ---------------- Baixa e descarte ----------------
  r.post('/api/equipamentos/:id/baixa', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'baixa.solicitar');
    const d = validar(z.object({ tipo: z.enum(['BAIXA', 'DESCARTE']), motivo: z.string().min(5), certificado: opcional(z.string()) }), body);
    return tx(u.id, async db => {
      const e = await db.one('SELECT status FROM equipamento WHERE id = $1', [params.id]);
      if (!e) throw new HttpError(404, 'Equipamento não encontrado');
      if (d.tipo === 'DESCARTE' && e.status !== 'BAIXADO') throw new HttpError(422, 'Descarte só para equipamento baixado');
      if (d.tipo === 'BAIXA' && ['BAIXADO', 'DESCARTADO'].includes(e.status)) throw new HttpError(422, 'Equipamento já baixado');
      return db.one(`INSERT INTO solicitacao_baixa (equipamento_id, tipo, motivo, certificado, solicitante_id)
                     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [params.id, d.tipo, d.motivo, d.certificado, u.id]);
    });
  });

  r.get('/api/baixas', async ({ usuario }) => {
    const u = exigir(usuario);
    return tx(u.id, db => db.query(
      `SELECT sb.*, e.descricao, e.numero_serie, e.status, l.codigo AS loja_codigo, us.nome AS solicitante, vc.custo_acumulado, e.valor_aquisicao
         FROM solicitacao_baixa sb JOIN equipamento e ON e.id = sb.equipamento_id JOIN loja l ON l.id = e.loja_id
         JOIN usuario us ON us.id = sb.solicitante_id LEFT JOIN vw_custo_equipamento vc ON vc.id = e.id
        WHERE sb.situacao = 'PENDENTE' ORDER BY sb.criado_em`));
  });

  r.post('/api/baixas/:id/decidir', async ({ usuario, params, body }) => {
    const u = exigir(usuario, 'baixa.aprovar');
    const d = validar(z.object({ aprovar: z.boolean(), justificativa: z.string().min(3) }), body);
    return tx(u.id, async db => {
      const s = await db.one(`SELECT * FROM solicitacao_baixa WHERE id = $1 AND situacao = 'PENDENTE' FOR UPDATE`, [params.id]);
      if (!s) throw new HttpError(404, 'Solicitação não encontrada');
      if (s.solicitante_id === u.id) throw new HttpError(422, 'Quem solicitou não pode aprovar (segregação de funções)');
      await db.query(`UPDATE solicitacao_baixa SET situacao = $2, decidido_por = $3, decidido_em = now(), justificativa = $4 WHERE id = $1`,
                     [s.id, d.aprovar ? 'APROVADA' : 'REJEITADA', u.id, d.justificativa]);
      if (d.aprovar) {
        // solicitante executa, gestor aprova: fn_movimentar valida perfil e segregação
        await db.query(`SELECT fn_movimentar(gen_random_uuid(), $1, $2, $3, now(), $4, p_aprovador_id => $5, p_documento => $6)`,
                       [s.equipamento_id, s.tipo === 'BAIXA' ? 'BAIXADO' : 'DESCARTADO', s.solicitante_id,
                        `${s.motivo} | Aprovação: ${d.justificativa}`, u.id, s.certificado]);
      }
      return { ok: true };
    });
  });
}
