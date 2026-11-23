-- SisTI: agenda de atividades (visitas técnicas, preventivas, instalações, coletas/entregas, reuniões).
-- Idempotente: pode ser executado em banco novo (após 04_app.sql) ou em banco já em uso.
-- Sem exclusão: agendamento sai da agenda pela situação CANCELADO.
SET search_path = sisti, public;

CREATE TABLE IF NOT EXISTS agendamento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          varchar(120) NOT NULL,
  tipo            varchar(20)  NOT NULL CHECK (tipo IN ('VISITA_TECNICA','PREVENTIVA','INSTALACAO','COLETA_ENTREGA','REUNIAO','OUTRO')),
  data            date NOT NULL,
  hora_inicio     time,
  hora_fim        time,
  loja_id         uuid REFERENCES loja(id),
  fornecedor_id   uuid REFERENCES fornecedor(id),
  chamado_id      uuid REFERENCES chamado(id),
  responsavel_id  uuid REFERENCES usuario(id),
  descricao       text,
  situacao        varchar(12) NOT NULL DEFAULT 'AGENDADO' CHECK (situacao IN ('AGENDADO','CONCLUIDO','CANCELADO')),
  criado_por      uuid NOT NULL REFERENCES usuario(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (hora_fim IS NULL OR hora_inicio IS NULL OR hora_fim > hora_inicio)
);
CREATE INDEX IF NOT EXISTS ix_agendamento_data ON agendamento (data);

-- Visibilidade: agendamento sem loja é de toda a rede; com loja segue a restrição por loja do usuário
ALTER TABLE agendamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_agenda_sel ON agendamento;
DROP POLICY IF EXISTS p_agenda_ins ON agendamento;
DROP POLICY IF EXISTS p_agenda_upd ON agendamento;
CREATE POLICY p_agenda_sel ON agendamento FOR SELECT USING (loja_id IS NULL OR fn_loja_permitida(loja_id));
CREATE POLICY p_agenda_ins ON agendamento FOR INSERT WITH CHECK (loja_id IS NULL OR fn_loja_permitida(loja_id));
CREATE POLICY p_agenda_upd ON agendamento FOR UPDATE USING (loja_id IS NULL OR fn_loja_permitida(loja_id));

GRANT SELECT, INSERT, UPDATE ON agendamento TO sisti_app;
