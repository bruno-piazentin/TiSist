-- SisTI 1.3.0: cadastro de PDVs (pontos de venda / checkouts) com periféricos vinculados e monitor de comunicação.
--
-- Situação do PDV (calculada na consulta, não gravada):
--   INATIVO  quando ativo = false (desligado/desmontado, marcado à mão);
--   PARADO   quando algum equipamento vinculado não está ATIVO (foi movimentado: manutenção, trânsito...);
--   ATIVO    nos demais casos.
-- A comunicação (responde ao ping / alertas do Zabbix) fica em pdv_comunicacao, atualizada pelo servidor.
SET search_path = sisti, public;

CREATE TABLE IF NOT EXISTS pdv (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES loja(id),
  numero         int  NOT NULL CHECK (numero BETWEEN 1 AND 999),
  ip             inet,
  ativo          boolean NOT NULL DEFAULT true,
  -- equipamentos vinculados (todos opcionais; cada equipamento só pode estar em um PDV)
  computador_id  uuid REFERENCES equipamento(id),
  impressora_id  uuid REFERENCES equipamento(id),
  scanner_id     uuid REFERENCES equipamento(id),
  teclado_id     uuid REFERENCES equipamento(id),
  gaveta_id      uuid REFERENCES equipamento(id),
  balanca_id     uuid REFERENCES equipamento(id),
  observacao     text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, numero)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pdv_ip ON pdv (ip) WHERE ip IS NOT NULL AND ativo;

-- Um equipamento não pode estar em dois PDVs (nem em duas posições do mesmo PDV)
CREATE OR REPLACE FUNCTION fn_pdv_periferico_unico() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sisti, public AS $$
DECLARE v_ids uuid[]; v_outro int;
BEGIN
  v_ids := array_remove(ARRAY[NEW.computador_id, NEW.impressora_id, NEW.scanner_id, NEW.teclado_id, NEW.gaveta_id, NEW.balanca_id], NULL);
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'O mesmo equipamento foi escolhido em duas posições do PDV';
  END IF;
  SELECT numero INTO v_outro FROM pdv p
   WHERE p.id <> NEW.id
     AND ARRAY[p.computador_id, p.impressora_id, p.scanner_id, p.teclado_id, p.gaveta_id, p.balanca_id] && v_ids
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Um dos equipamentos já está vinculado ao PDV % (desvincule lá primeiro)', v_outro;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_pdv_periferico_unico ON pdv;
CREATE TRIGGER tg_pdv_periferico_unico BEFORE INSERT OR UPDATE ON pdv
  FOR EACH ROW EXECUTE FUNCTION fn_pdv_periferico_unico();

-- Restrição por loja, como equipamentos
ALTER TABLE pdv ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pdv_sel ON pdv;
DROP POLICY IF EXISTS p_pdv_ins ON pdv;
DROP POLICY IF EXISTS p_pdv_upd ON pdv;
CREATE POLICY p_pdv_sel ON pdv FOR SELECT USING (fn_loja_permitida(loja_id));
CREATE POLICY p_pdv_ins ON pdv FOR INSERT WITH CHECK (fn_loja_permitida(loja_id));
CREATE POLICY p_pdv_upd ON pdv FOR UPDATE USING (fn_loja_permitida(loja_id)) WITH CHECK (fn_loja_permitida(loja_id));

-- Estado da comunicação, gravado pelo monitor do servidor (sem dados sensíveis, sem RLS)
CREATE TABLE IF NOT EXISTS pdv_comunicacao (
  pdv_id            uuid PRIMARY KEY REFERENCES pdv(id),
  online            boolean,                -- respondeu na última verificação
  verificado_em     timestamptz,
  ultima_resposta   timestamptz,            -- último momento em que respondeu
  offline_desde     timestamptz,            -- início da falha atual (null quando online)
  latencia_ms       int,
  zabbix_disponivel boolean,                -- null = Zabbix não configurado ou host não encontrado
  zabbix_problemas  jsonb,                  -- [{nome, severidade, desde}]
  zabbix_verificado_em timestamptz
);

-- O monitor roda sem usuário logado (o RLS esconderia tudo): esta função entrega só id e IP dos PDVs ativos
CREATE OR REPLACE FUNCTION fn_pdv_para_monitorar() RETURNS TABLE (id uuid, ip text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = sisti, public AS $$
  SELECT p.id, host(p.ip) FROM pdv p WHERE p.ativo AND p.ip IS NOT NULL
$$;

GRANT SELECT, INSERT, UPDATE ON pdv, pdv_comunicacao TO sisti_app;
GRANT EXECUTE ON FUNCTION fn_pdv_para_monitorar() TO sisti_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisti_leitura') THEN
    GRANT SELECT ON pdv, pdv_comunicacao TO sisti_leitura;
  END IF;
END $$;
