-- =====================================================================
-- SisTI - Camada de aplicação no banco
--   * senha local (até integrar SSO), perfis padrão
--   * Row Level Security por loja
--   * eventos automáticos de chamado, orçamento e custo
--   * papel de banco da aplicação (sisti_app) sem DELETE
-- Execução: psql -d sisti -f 04_app.sql   (depois de 01 e 02)
-- =====================================================================
SET search_path = sisti, public;
SET client_min_messages = warning;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS senha_hash text;          -- bcrypt via pgcrypto: crypt(senha, gen_salt('bf', 10))
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ultimo_acesso timestamptz;

-- Perfis padrão (seção 10 da especificação)
INSERT INTO perfil (codigo, nome) VALUES
 ('ADMIN','Administrador do sistema'),
 ('GESTOR_TI','Gestor de TI'),
 ('COORDENADOR','Coordenador'),
 ('TECNICO','Técnico de TI'),
 ('GERENTE_LOJA','Gerente de loja'),
 ('COMPRAS','Compras / financeiro'),
 ('AUDITORIA','Auditoria'),
 ('DIRETORIA','Diretoria')
ON CONFLICT (codigo) DO NOTHING;

-- Coordenador também pode aprovar baixa
CREATE OR REPLACE FUNCTION fn_perfil_usuario(p_usuario uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT pf.codigo FROM usuario u JOIN perfil pf ON pf.id = u.perfil_id WHERE u.id = p_usuario
$$;

-- ---------------------------------------------------------------------
-- Conflitos de sincronização offline (resolvidos pelo técnico)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_conflito (
  id            uuid PRIMARY KEY,               -- UUID da operação enviada pelo aparelho
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  tipo          varchar(40) NOT NULL,           -- ABRIR_CHAMADO, MOVIMENTAR...
  payload       jsonb NOT NULL,
  erro          text NOT NULL,
  ocorrido_em   timestamptz NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em  timestamptz,
  resolvido_por uuid REFERENCES usuario(id),
  resolucao     text
);

-- ---------------------------------------------------------------------
-- Solicitação de baixa/descarte (exige aprovador diferente do solicitante)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitacao_baixa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipamento_id  uuid NOT NULL REFERENCES equipamento(id),
  tipo            varchar(10) NOT NULL CHECK (tipo IN ('BAIXA','DESCARTE')),
  motivo          text NOT NULL,
  certificado     text,                      -- nº do certificado de destinação (descarte)
  solicitante_id  uuid NOT NULL REFERENCES usuario(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  situacao        varchar(10) NOT NULL DEFAULT 'PENDENTE' CHECK (situacao IN ('PENDENTE','APROVADA','REJEITADA')),
  decidido_por    uuid REFERENCES usuario(id),
  decidido_em     timestamptz,
  justificativa   text,
  CHECK (decidido_por IS NULL OR decidido_por <> solicitante_id),
  CHECK (tipo <> 'DESCARTE' OR certificado IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_baixa_pendente ON solicitacao_baixa (equipamento_id) WHERE situacao = 'PENDENTE';

-- ---------------------------------------------------------------------
-- Eventos automáticos (linha do tempo)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_usuario_sessao() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('sisti.usuario_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION fn_evento_chamado() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
    VALUES ('CHAMADO_ABERTO','chamado', NEW.id, NEW.equipamento_id,
            jsonb_build_object('numero',NEW.numero,'tipo',NEW.tipo,'prioridade',NEW.prioridade,'relato',NEW.relato,
                               'em_garantia',NEW.em_garantia,'reincidente',NEW.reincidente,
                               'categoria_falha_id',coalesce(NEW.categoria_falha_id,NEW.categoria_falha_relatada_id)),
            NEW.solicitante_id, NEW.aberto_em);
  ELSE
    IF NEW.situacao IS DISTINCT FROM OLD.situacao THEN
      INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
      VALUES ('CHAMADO_' || NEW.situacao, 'chamado', NEW.id, NEW.equipamento_id,
              jsonb_build_object('numero',NEW.numero,'situacao_anterior',OLD.situacao,'situacao_nova',NEW.situacao,
                                 'diagnostico',NEW.diagnostico,'causa_raiz',NEW.causa_raiz,
                                 'categoria_falha_id',NEW.categoria_falha_id),
              fn_usuario_sessao(), CASE WHEN NEW.situacao IN ('ENCERRADO','CANCELADO') THEN coalesce(NEW.encerrado_em, now()) ELSE now() END);
    ELSIF NEW.diagnostico IS DISTINCT FROM OLD.diagnostico THEN
      INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
      VALUES ('DIAGNOSTICO_REGISTRADO','chamado', NEW.id, NEW.equipamento_id,
              jsonb_build_object('numero',NEW.numero,'diagnostico',NEW.diagnostico,'causa_raiz',NEW.causa_raiz),
              fn_usuario_sessao(), now());
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_evento_chamado ON chamado;
CREATE TRIGGER tg_evento_chamado AFTER INSERT OR UPDATE ON chamado
  FOR EACH ROW EXECUTE FUNCTION fn_evento_chamado();

CREATE OR REPLACE FUNCTION fn_evento_orcamento() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
    VALUES (CASE WHEN TG_OP = 'INSERT' THEN 'ORCAMENTO_REGISTRADO' ELSE 'ORCAMENTO_' || NEW.status END,
            'orcamento', NEW.id, NEW.equipamento_id,
            jsonb_build_object('numero',NEW.numero,'versao',NEW.versao,'status',NEW.status,
                               'valor_total',NEW.valor_total,'fornecedor_id',NEW.fornecedor_id,
                               'aprovador_id',NEW.aprovador_id,'justificativa',NEW.justificativa_decisao),
            coalesce(fn_usuario_sessao(), NEW.solicitante_id),
            CASE WHEN TG_OP = 'INSERT' THEN least(now(), coalesce(NEW.decidido_em - interval '1 day', now())) ELSE coalesce(NEW.decidido_em, now()) END);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_evento_orcamento ON orcamento;
CREATE TRIGGER tg_evento_orcamento AFTER INSERT OR UPDATE ON orcamento
  FOR EACH ROW EXECUTE FUNCTION fn_evento_orcamento();

CREATE OR REPLACE FUNCTION fn_evento_custo() RETURNS trigger AS $$
BEGIN
  INSERT INTO evento (tipo, entidade, entidade_id, equipamento_id, payload, usuario_id, ocorrido_em)
  VALUES (CASE WHEN NEW.estorno_de IS NULL THEN 'CUSTO_LANCADO' ELSE 'CUSTO_ESTORNADO' END,
          'custo', NEW.id, NEW.equipamento_id,
          jsonb_build_object('tipo',NEW.tipo,'valor',NEW.valor,'competencia',NEW.competencia,
                             'nfe_chave',NEW.nfe_chave,'estorno_de',NEW.estorno_de,'chamado_id',NEW.chamado_id),
          NEW.usuario_id, NEW.registrado_em);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_evento_custo ON custo_lancamento;
CREATE TRIGGER tg_evento_custo AFTER INSERT ON custo_lancamento
  FOR EACH ROW EXECUTE FUNCTION fn_evento_custo();

-- ---------------------------------------------------------------------
-- Row Level Security por loja
-- Perfis de rede veem todas as lojas; os demais, só as de usuario_loja.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_loja_permitida(p_loja uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN fn_usuario_sessao() IS NULL THEN false
    WHEN fn_perfil_usuario(fn_usuario_sessao()) IN ('ADMIN','GESTOR_TI','COORDENADOR','COMPRAS','AUDITORIA','DIRETORIA') THEN true
    ELSE EXISTS (SELECT 1 FROM usuario_loja ul WHERE ul.usuario_id = fn_usuario_sessao() AND ul.loja_id = p_loja)
  END
$$;

ALTER TABLE equipamento      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chamado          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento        ENABLE ROW LEVEL SECURITY;
ALTER TABLE custo_lancamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacao     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_equip_sel ON equipamento;
DROP POLICY IF EXISTS p_equip_ins ON equipamento;
DROP POLICY IF EXISTS p_equip_upd ON equipamento;
CREATE POLICY p_equip_sel ON equipamento FOR SELECT USING (fn_loja_permitida(loja_id));
CREATE POLICY p_equip_ins ON equipamento FOR INSERT WITH CHECK (fn_loja_permitida(loja_id));
-- WITH CHECK livre: transferência pode levar o equipamento para loja que o usuário não vê
CREATE POLICY p_equip_upd ON equipamento FOR UPDATE USING (fn_loja_permitida(loja_id)) WITH CHECK (true);

DROP POLICY IF EXISTS p_cham_sel ON chamado;
DROP POLICY IF EXISTS p_cham_ins ON chamado;
DROP POLICY IF EXISTS p_cham_upd ON chamado;
CREATE POLICY p_cham_sel ON chamado FOR SELECT USING (fn_loja_permitida(loja_id));
CREATE POLICY p_cham_ins ON chamado FOR INSERT WITH CHECK (true);   -- loja é forçada pelo trigger a partir do equipamento visível
CREATE POLICY p_cham_upd ON chamado FOR UPDATE USING (fn_loja_permitida(loja_id));

DROP POLICY IF EXISTS p_orc_sel ON orcamento;
DROP POLICY IF EXISTS p_orc_ins ON orcamento;
DROP POLICY IF EXISTS p_orc_upd ON orcamento;
CREATE POLICY p_orc_sel ON orcamento FOR SELECT USING (fn_loja_permitida(loja_id));
CREATE POLICY p_orc_ins ON orcamento FOR INSERT WITH CHECK (fn_loja_permitida(loja_id));
CREATE POLICY p_orc_upd ON orcamento FOR UPDATE USING (fn_loja_permitida(loja_id));

DROP POLICY IF EXISTS p_custo_sel ON custo_lancamento;
DROP POLICY IF EXISTS p_custo_ins ON custo_lancamento;
CREATE POLICY p_custo_sel ON custo_lancamento FOR SELECT USING (fn_loja_permitida(loja_id));
CREATE POLICY p_custo_ins ON custo_lancamento FOR INSERT WITH CHECK (fn_loja_permitida(loja_id));

DROP POLICY IF EXISTS p_mov_sel ON movimentacao;
DROP POLICY IF EXISTS p_mov_ins ON movimentacao;
CREATE POLICY p_mov_sel ON movimentacao FOR SELECT
  USING (fn_loja_permitida(loja_origem_id) OR fn_loja_permitida(loja_destino_id));
CREATE POLICY p_mov_ins ON movimentacao FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS p_evt_sel ON evento;
DROP POLICY IF EXISTS p_evt_ins ON evento;
CREATE POLICY p_evt_sel ON evento FOR SELECT
  USING (equipamento_id IS NULL OR EXISTS (SELECT 1 FROM equipamento e WHERE e.id = evento.equipamento_id));
CREATE POLICY p_evt_ins ON evento FOR INSERT WITH CHECK (true);

-- Remoção de vínculo usuário x loja: única exclusão permitida, só para administrador
CREATE OR REPLACE FUNCTION fn_desvincular_lojas(p_usuario uuid, p_lojas uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sisti, public AS $$
BEGIN
  IF fn_perfil_usuario(fn_usuario_sessao()) IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Somente administrador altera lojas de acesso';
  END IF;
  DELETE FROM usuario_loja WHERE usuario_id = p_usuario AND loja_id = ANY(p_lojas);
END $$;

-- ---------------------------------------------------------------------
-- Papel de banco da aplicação
-- (defina a senha depois: ALTER ROLE sisti_app PASSWORD '...';)
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisti_app') THEN
    CREATE ROLE sisti_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA sisti TO sisti_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sisti TO sisti_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sisti TO sisti_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sisti TO sisti_app;
-- histórico e custo: somente inclusão também por permissão
REVOKE UPDATE ON evento, movimentacao, custo_lancamento FROM sisti_app;
-- nenhuma exclusão pela aplicação
REVOKE DELETE ON ALL TABLES IN SCHEMA sisti FROM sisti_app;
