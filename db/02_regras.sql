-- =====================================================================
-- SisTI - Regras de negócio no banco (triggers, funções e views)
-- Execução: psql -d sisti -f 02_regras.sql   (depois de 01_schema.sql)
-- =====================================================================
SET search_path = sisti, public;

-- ---------------------------------------------------------------------
-- 1. Parâmetros iniciais (exemplos; ajustar na implantação)
-- ---------------------------------------------------------------------
INSERT INTO parametro (chave, valor, descricao) VALUES
 ('reincidencia_equip_dias',      90, 'Janela para reincidência no mesmo equipamento'),
 ('reincidencia_equip_qtd',        2, 'Falhas da mesma categoria na janela'),
 ('reincidencia_modelo_dias',     90, 'Janela para reincidência por modelo'),
 ('reincidencia_modelo_taxa_pct', 20, '% de unidades do modelo com a mesma falha na janela'),
 ('reincidencia_modelo_min_equip', 3, 'Mínimo de equipamentos afetados para sinalizar modelo'),
 ('alerta_desvio_orcado_pct',     10, 'Desvio realizado x orçado que gera alerta'),
 ('alerta_custo_aquisicao_pct',   50, '% do valor de compra que sugere substituição'),
 ('alerta_parado_dias',           15, 'Dias sem movimentação em manutenção'),
 ('cotacoes_minimas',              3, 'Cotações exigidas acima do valor relevante'),
 ('valor_relevante_cotacao',    1000, 'Valor (R$) a partir do qual se exigem cotações');

-- Alçadas de exemplo (valores a validar com a diretoria)
INSERT INTO alcada (perfil_codigo, valor_ate) VALUES
 ('GESTOR_TI', 1000), ('COORDENADOR', 5000), ('DIRETORIA', NULL);

-- ---------------------------------------------------------------------
-- 2. Matriz de transições permitidas
-- ---------------------------------------------------------------------
INSERT INTO transicao_status (de, para, exige_orcamento_ou_preventiva, exige_documento_transporte,
                              exige_destino, exige_confirmacao_receb, exige_teste, exige_aprovacao_gestor, descricao) VALUES
 ('EM_ESTOQUE','ATIVO',               false,false,false,false,true ,false,'Instalação na loja'),
 ('EM_ESTOQUE','TRANSITO',            false,true ,true ,false,false,false,'Envio do estoque/CD para loja'),
 ('EM_ESTOQUE','EM_RESERVA',          false,false,false,false,false,false,'Separado como contingência'),
 ('ATIVO','AGUARDANDO_ORCAMENTO',     false,false,false,false,false,false,'Abertura de chamado corretivo'),
 ('ATIVO','EM_MANUTENCAO',            true ,false,false,false,false,false,'Preventiva ou reparo no local já aprovado'),
 ('ATIVO','TRANSITO',                 false,true ,true ,false,false,false,'Transferência entre lojas'),
 ('ATIVO','EM_RESERVA',               false,false,false,false,false,false,'Retirado de uso e mantido como reserva'),
 ('ATIVO','SINISTRADO',               false,false,false,false,false,false,'Dano por evento externo'),
 ('EM_RESERVA','ATIVO',               false,false,false,false,true ,false,'Reserva colocada em operação'),
 ('EM_RESERVA','TRANSITO',            false,true ,true ,false,false,false,'Reserva enviada a outra loja'),
 ('AGUARDANDO_ORCAMENTO','EM_MANUTENCAO', true ,false,false,false,false,false,'Orçamento aprovado'),
 ('AGUARDANDO_ORCAMENTO','ATIVO',     false,false,false,false,true ,false,'Chamado cancelado ou resolvido sem custo'),
 ('AGUARDANDO_ORCAMENTO','TRANSITO',  false,true ,true ,false,false,false,'Envio para diagnóstico em bancada'),
 ('EM_MANUTENCAO','TRANSITO',         false,true ,true ,false,false,false,'Saída para o fornecedor ou retorno à loja'),
 ('EM_MANUTENCAO','ATIVO',            false,false,false,true ,true ,false,'Reparo concluído e testado'),
 ('TRANSITO','EM_MANUTENCAO',         false,false,false,true ,false,false,'Recebido pelo fornecedor (reparo aprovado)'),
 ('TRANSITO','AGUARDANDO_ORCAMENTO',  false,false,false,true ,false,false,'Recebido pelo fornecedor para orçar'),
 ('TRANSITO','ATIVO',                 false,false,false,true ,true ,false,'Recebido na loja e testado'),
 ('TRANSITO','EM_ESTOQUE',            false,false,false,true ,false,false,'Recebido no CD/estoque'),
 ('TRANSITO','EM_RESERVA',            false,false,false,true ,false,false,'Recebido como reserva'),
 ('SINISTRADO','AGUARDANDO_ORCAMENTO',false,false,false,false,false,false,'Avaliação para reparo'),
 ('BAIXADO','DESCARTADO',             false,false,false,false,false,true ,'Destinação final com certificado');

-- Qualquer status (exceto BAIXADO/DESCARTADO) pode ir para BAIXADO com aprovação de gestor
INSERT INTO transicao_status (de, para, exige_aprovacao_gestor, descricao)
SELECT s, 'BAIXADO', true, 'Baixa com motivo e aprovação de gestor'
FROM unnest(enum_range(NULL::status_equipamento)) s
WHERE s NOT IN ('BAIXADO','DESCARTADO');

-- ---------------------------------------------------------------------
-- 3. Imutabilidade (append-only)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_bloqueia_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é somente inclusão. Use um lançamento de estorno/ajuste.', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER tg_evento_imutavel       BEFORE UPDATE OR DELETE ON evento           FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_movimentacao_imutavel BEFORE UPDATE OR DELETE ON movimentacao     FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();
CREATE TRIGGER tg_custo_imutavel        BEFORE UPDATE OR DELETE ON custo_lancamento FOR EACH ROW EXECUTE FUNCTION fn_bloqueia_alteracao();

-- Orçamento aprovado/reprovado não muda (exceto marcar como SUBSTITUIDO quando houver nova versão)
CREATE OR REPLACE FUNCTION fn_orcamento_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Orçamento não pode ser excluído';
  END IF;
  IF OLD.status IN ('APROVADO','REPROVADO','SUBSTITUIDO') THEN
    IF NOT (OLD.status = 'APROVADO' AND NEW.status = 'SUBSTITUIDO'
            AND (to_jsonb(NEW) - 'status' - 'valor_total') = (to_jsonb(OLD) - 'status' - 'valor_total')) THEN
      RAISE EXCEPTION 'Orçamento % v% já decidido: gere nova versão', OLD.numero, OLD.versao;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_orcamento_imutavel BEFORE UPDATE OR DELETE ON orcamento
  FOR EACH ROW EXECUTE FUNCTION fn_orcamento_imutavel();

-- Aprovação: aprovador com alçada suficiente e ativo
CREATE OR REPLACE FUNCTION fn_valida_aprovacao() RETURNS trigger AS $$
DECLARE v_alcada numeric; v_ativo boolean; v_total numeric;
BEGIN
  -- coluna gerada ainda não está calculada em trigger BEFORE: soma manual
  v_total := NEW.valor_pecas + NEW.valor_mao_obra + NEW.valor_frete + NEW.valor_deslocamento;
  IF NEW.status = 'APROVADO' AND (TG_OP = 'INSERT' OR OLD.status <> 'APROVADO') THEN
    SELECT alcada_max, ativo INTO v_alcada, v_ativo FROM usuario WHERE id = NEW.aprovador_id;
    IF NOT coalesce(v_ativo,false) THEN
      RAISE EXCEPTION 'Aprovador inativo ou inexistente';
    END IF;
    IF v_total > v_alcada THEN
      RAISE EXCEPTION 'Valor % acima da alçada do aprovador (%)', v_total, v_alcada;
    END IF;
    NEW.decidido_em := coalesce(NEW.decidido_em, now());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_valida_aprovacao BEFORE INSERT OR UPDATE ON orcamento
  FOR EACH ROW EXECUTE FUNCTION fn_valida_aprovacao();

-- Competência fechada não recebe custo
CREATE OR REPLACE FUNCTION fn_valida_competencia() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fechamento_mensal WHERE competencia = NEW.competencia) THEN
    RAISE EXCEPTION 'Competência % fechada. Lance na competência aberta com referência.', NEW.competencia;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_valida_competencia BEFORE INSERT ON custo_lancamento
  FOR EACH ROW EXECUTE FUNCTION fn_valida_competencia();

-- ---------------------------------------------------------------------
-- 4. Equipamento: loja e status só mudam por movimentação formal
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protege_equipamento() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Equipamento não pode ser excluído: use baixa';
  END IF;
  IF (NEW.loja_id, NEW.status, NEW.local_tipo, NEW.local_loja_id, NEW.local_fornecedor_id)
     IS DISTINCT FROM (OLD.loja_id, OLD.status, OLD.local_tipo, OLD.local_loja_id, OLD.local_fornecedor_id)
     AND current_setting('sisti.via_movimentacao', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Loja, status e localização só mudam por movimentação (fn_movimentar)';
  END IF;
  IF OLD.status IN ('BAIXADO','DESCARTADO')
     AND current_setting('sisti.via_movimentacao', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Equipamento baixado/descartado não pode ser alterado';
  END IF;
  -- registra alteração cadastral relevante no histórico
  IF (NEW.departamento_id, NEW.responsavel_uso, NEW.ponto_instalacao, NEW.numero_serie, NEW.patrimonio)
     IS DISTINCT FROM (OLD.departamento_id, OLD.responsavel_uso, OLD.ponto_instalacao, OLD.numero_serie, OLD.patrimonio) THEN
    INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
    VALUES ('CADASTRO_ALTERADO','equipamento', NEW.id, NEW.id,
            jsonb_build_object('anterior', jsonb_build_object('departamento_id',OLD.departamento_id,'responsavel_uso',OLD.responsavel_uso,
                                 'ponto_instalacao',OLD.ponto_instalacao,'numero_serie',OLD.numero_serie,'patrimonio',OLD.patrimonio),
                               'novo',     jsonb_build_object('departamento_id',NEW.departamento_id,'responsavel_uso',NEW.responsavel_uso,
                                 'ponto_instalacao',NEW.ponto_instalacao,'numero_serie',NEW.numero_serie,'patrimonio',NEW.patrimonio)),
            nullif(current_setting('sisti.usuario_id', true),'')::uuid, now());
  END IF;
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_protege_equipamento BEFORE UPDATE OR DELETE ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_protege_equipamento();

-- Unidade fechada não recebe novos equipamentos
CREATE OR REPLACE FUNCTION fn_valida_loja_ativa() RETURNS trigger AS $$
BEGIN
  IF (SELECT situacao FROM loja WHERE id = NEW.loja_id) = 'FECHADA' THEN
    RAISE EXCEPTION 'Loja fechada não recebe equipamentos';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_valida_loja_ativa BEFORE INSERT ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_valida_loja_ativa();

-- ---------------------------------------------------------------------
-- 5. Função única de movimentação (valida a matriz e grava anterior/atual)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_movimentar(
  p_id                uuid,                -- UUID gerado no aparelho (idempotência)
  p_equipamento_id    uuid,
  p_status_novo       status_equipamento,
  p_usuario_id        uuid,
  p_ocorrido_em       timestamptz,
  p_motivo            text DEFAULT NULL,
  p_destino_tipo      tipo_local DEFAULT NULL,
  p_loja_destino_id   uuid DEFAULT NULL,
  p_fornecedor_destino_id uuid DEFAULT NULL,
  p_documento         varchar DEFAULT NULL,
  p_chamado_id        uuid DEFAULT NULL,
  p_orcamento_id      uuid DEFAULT NULL,
  p_confirmou_receb   boolean DEFAULT false,
  p_teste_ok          boolean DEFAULT NULL,
  p_aprovador_id      uuid DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  e   equipamento%ROWTYPE;
  t   transicao_status%ROWTYPE;
  mov_dest_tipo tipo_local; mov_dest_loja uuid; mov_dest_forn uuid;
BEGIN
  -- idempotência: reenvio do app offline não duplica
  IF EXISTS (SELECT 1 FROM movimentacao WHERE id = p_id) THEN
    RETURN p_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_usuario_id AND ativo) THEN
    RAISE EXCEPTION 'Usuário inativo não executa ações';
  END IF;

  SELECT * INTO e FROM equipamento WHERE id = p_equipamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento inexistente'; END IF;

  SELECT * INTO t FROM transicao_status WHERE de = e.status AND para = p_status_novo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transição % -> % não permitida', e.status, p_status_novo;
  END IF;

  IF t.exige_motivo AND coalesce(trim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'Motivo obrigatório para % -> %', e.status, p_status_novo;
  END IF;

  IF t.exige_orcamento_ou_preventiva AND NOT (
       EXISTS (SELECT 1 FROM orcamento o WHERE o.id = p_orcamento_id
                 AND o.equipamento_id = e.id AND o.status = 'APROVADO')
    OR EXISTS (SELECT 1 FROM chamado c WHERE c.id = p_chamado_id
                 AND c.equipamento_id = e.id AND c.tipo = 'PREVENTIVA'
                 AND c.situacao NOT IN ('ENCERRADO','CANCELADO'))) THEN
    RAISE EXCEPTION 'Em manutenção exige orçamento aprovado ou ordem preventiva';
  END IF;

  -- recebimento no fornecedor para reparo também exige orçamento aprovado
  IF e.status = 'TRANSITO' AND p_status_novo = 'EM_MANUTENCAO' AND NOT EXISTS (
       SELECT 1 FROM orcamento o WHERE o.equipamento_id = e.id AND o.status = 'APROVADO'
         AND o.chamado_id = p_chamado_id) THEN
    RAISE EXCEPTION 'Recebimento para reparo exige orçamento aprovado no chamado';
  END IF;

  IF t.exige_documento_transporte AND coalesce(trim(p_documento),'') = '' THEN
    RAISE EXCEPTION 'Trânsito exige nota de remessa ou romaneio';
  END IF;
  IF t.exige_destino AND p_destino_tipo IS NULL THEN
    RAISE EXCEPTION 'Trânsito exige destino';
  END IF;
  IF t.exige_confirmacao_receb AND NOT p_confirmou_receb THEN
    RAISE EXCEPTION 'Confirmação de recebimento obrigatória';
  END IF;
  IF t.exige_teste AND p_teste_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Teste de funcionamento aprovado é obrigatório';
  END IF;
  IF t.exige_aprovacao_gestor AND (p_aprovador_id IS NULL OR p_aprovador_id = p_usuario_id
       OR NOT EXISTS (SELECT 1 FROM usuario u JOIN perfil pf ON pf.id = u.perfil_id
                      WHERE u.id = p_aprovador_id AND u.ativo AND pf.codigo IN ('GESTOR_TI','COORDENADOR','DIRETORIA'))) THEN
    RAISE EXCEPTION 'Transição exige aprovação de gestor diferente do solicitante';
  END IF;
  IF p_destino_tipo = 'FORNECEDOR' AND NOT EXISTS (
       SELECT 1 FROM fornecedor WHERE id = p_fornecedor_destino_id AND homologado) THEN
    RAISE EXCEPTION 'Somente fornecedor homologado recebe equipamento';
  END IF;

  -- destino de quem sai de TRANSITO = destino gravado na última movimentação
  IF e.status = 'TRANSITO' THEN
    SELECT local_destino_tipo, loja_destino_id, fornecedor_destino_id
      INTO mov_dest_tipo, mov_dest_loja, mov_dest_forn
      FROM movimentacao WHERE equipamento_id = e.id
     ORDER BY ocorrido_em DESC, registrado_em DESC LIMIT 1;
  END IF;

  INSERT INTO movimentacao (id, equipamento_id, status_anterior, status_novo, loja_origem_id,
       local_destino_tipo, loja_destino_id, fornecedor_destino_id, chamado_id, orcamento_id,
       documento_transporte, motivo, usuario_id, aprovador_id, ocorrido_em)
  VALUES (p_id, e.id, e.status, p_status_novo, e.loja_id,
       p_destino_tipo, p_loja_destino_id, p_fornecedor_destino_id, p_chamado_id, p_orcamento_id,
       p_documento, p_motivo, p_usuario_id, p_aprovador_id, p_ocorrido_em);

  PERFORM set_config('sisti.via_movimentacao', 'on', true);  -- vale só nesta transação

  UPDATE equipamento SET
    status = p_status_novo,
    local_tipo          = CASE WHEN e.status = 'TRANSITO' THEN mov_dest_tipo ELSE e.local_tipo END,
    local_loja_id       = CASE WHEN e.status = 'TRANSITO' THEN mov_dest_loja ELSE e.local_loja_id END,
    local_fornecedor_id = CASE WHEN e.status = 'TRANSITO' THEN mov_dest_forn ELSE e.local_fornecedor_id END,
    -- transferência entre lojas: ao chegar, muda a loja vinculada
    loja_id = CASE WHEN e.status = 'TRANSITO' AND mov_dest_tipo = 'LOJA'
                    AND mov_dest_loja IS DISTINCT FROM e.loja_id
                   THEN mov_dest_loja ELSE e.loja_id END
  WHERE id = e.id;

  PERFORM set_config('sisti.via_movimentacao', 'off', true);

  INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
  VALUES ('STATUS_ALTERADO','equipamento', e.id, e.id,
          jsonb_build_object('status_anterior', e.status, 'status_novo', p_status_novo,
                             'movimentacao_id', p_id, 'motivo', p_motivo, 'documento', p_documento),
          p_usuario_id, p_ocorrido_em);
  RETURN p_id;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 6. Abertura de chamado: bloqueia baixado, calcula garantia e reincidência
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_chamado_abertura() RETURNS trigger AS $$
DECLARE e equipamento%ROWTYPE; v_janela int; v_qtd int;
BEGIN
  SELECT * INTO e FROM equipamento WHERE id = NEW.equipamento_id;
  IF e.status IN ('BAIXADO','DESCARTADO') THEN
    RAISE EXCEPTION 'Não é possível abrir ordem para equipamento baixado ou descartado';
  END IF;
  NEW.loja_id := e.loja_id;
  NEW.em_garantia := e.garantia_fim IS NOT NULL AND NEW.aberto_em::date <= e.garantia_fim;

  SELECT valor INTO v_janela FROM parametro WHERE chave = 'reincidencia_equip_dias';
  SELECT valor INTO v_qtd    FROM parametro WHERE chave = 'reincidencia_equip_qtd';
  IF NEW.categoria_falha_id IS NOT NULL THEN
    NEW.reincidente := (
      SELECT count(*) + 1 >= v_qtd FROM chamado c
       WHERE c.equipamento_id = NEW.equipamento_id
         AND c.categoria_falha_id = NEW.categoria_falha_id
         AND c.situacao <> 'CANCELADO'
         AND c.aberto_em >= NEW.aberto_em - make_interval(days => v_janela));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tg_chamado_abertura BEFORE INSERT ON chamado
  FOR EACH ROW EXECUTE FUNCTION fn_chamado_abertura();

-- ---------------------------------------------------------------------
-- 7. Views de custo e reincidência
-- ---------------------------------------------------------------------
-- Custo acumulado por equipamento x valor de aquisição (TCO)
CREATE OR REPLACE VIEW vw_custo_equipamento AS
SELECT e.id, e.descricao, e.numero_serie, e.loja_id, e.produto_id, e.valor_aquisicao,
       coalesce(sum(c.valor),0)                                         AS custo_acumulado,
       coalesce(sum(c.valor) FILTER (WHERE c.tipo='PECA'),0)            AS custo_pecas,
       coalesce(sum(c.valor) FILTER (WHERE c.tipo='MAO_DE_OBRA'),0)     AS custo_mao_obra,
       coalesce(sum(c.valor) FILTER (WHERE c.tipo IN ('FRETE','DESLOCAMENTO')),0) AS custo_logistica,
       round(100 * coalesce(sum(c.valor),0) / nullif(e.valor_aquisicao,0), 1)     AS pct_aquisicao,
       coalesce(sum(c.valor),0) >= (SELECT valor FROM parametro WHERE chave='alerta_custo_aquisicao_pct')/100
                                   * nullif(e.valor_aquisicao,0)                  AS sugerir_substituicao
FROM equipamento e
LEFT JOIN custo_lancamento c ON c.equipamento_id = e.id
GROUP BY e.id;

-- Custo por loja e competência, com indicadores normalizados
CREATE OR REPLACE VIEW vw_custo_loja_mes AS
SELECT l.id AS loja_id, l.nome_fantasia, c.competencia,
       sum(c.valor)                                   AS custo_total,
       round(sum(c.valor) / nullif(l.area_m2,0), 2)   AS custo_por_m2,
       round(sum(c.valor) / nullif(l.qtd_checkouts,0), 2) AS custo_por_checkout
FROM custo_lancamento c JOIN loja l ON l.id = c.loja_id
GROUP BY l.id, c.competencia;

-- Reincidência por modelo: taxa de falha sobre a base instalada (não número absoluto)
CREATE OR REPLACE VIEW vw_reincidencia_modelo AS
WITH par AS (
  SELECT max(valor) FILTER (WHERE chave='reincidencia_modelo_dias')      AS dias,
         max(valor) FILTER (WHERE chave='reincidencia_modelo_taxa_pct')  AS taxa,
         max(valor) FILTER (WHERE chave='reincidencia_modelo_min_equip') AS minimo
  FROM parametro),
base AS (
  SELECT produto_id, count(*) AS instalados
  FROM equipamento WHERE status NOT IN ('BAIXADO','DESCARTADO','EM_ESTOQUE')
  GROUP BY produto_id),
falhas AS (
  SELECT e.produto_id, c.categoria_falha_id,
         count(DISTINCT c.equipamento_id) AS equip_afetados,
         count(*)                         AS ocorrencias
  FROM chamado c JOIN equipamento e ON e.id = c.equipamento_id, par
  WHERE c.tipo = 'CORRETIVA' AND c.situacao <> 'CANCELADO'
    AND c.aberto_em >= now() - make_interval(days => par.dias::int)
  GROUP BY e.produto_id, c.categoria_falha_id)
SELECT p.id AS produto_id, p.modelo, f.categoria_falha_id, b.instalados, f.equip_afetados, f.ocorrencias,
       round(100.0 * f.equip_afetados / b.instalados, 1) AS taxa_pct,
       (f.equip_afetados >= par.minimo AND 100.0 * f.equip_afetados / b.instalados >= par.taxa) AS sinalizar_lote
FROM falhas f JOIN base b USING (produto_id) JOIN produto p ON p.id = f.produto_id, par;

-- Linha do tempo consolidada de um equipamento
CREATE OR REPLACE VIEW vw_linha_tempo AS
SELECT equipamento_id, ocorrido_em, registrado_em, tipo, payload, usuario_id
FROM evento WHERE equipamento_id IS NOT NULL;
