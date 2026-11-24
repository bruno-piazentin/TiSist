-- SisTI 1.4.0: configurações de integração (endereços de API e servidores) no banco, editáveis na tela Parâmetros,
-- e permissão por usuário para alterar cada grupo de parâmetros.
SET search_path = sisti, public;

-- Parâmetros numéricos existentes ganham grupo (a permissão de alteração é por grupo)
ALTER TABLE parametro ADD COLUMN IF NOT EXISTS grupo varchar(30) NOT NULL DEFAULT 'REGRAS';
UPDATE parametro SET grupo = 'SEGURANCA' WHERE chave LIKE 'login\_%';

-- Configurações de texto (endereços, portas, intervalos das integrações)
CREATE TABLE configuracao (
  chave          varchar(60) PRIMARY KEY,
  grupo          varchar(30) NOT NULL,
  rotulo         text NOT NULL,
  descricao      text,
  tipo           varchar(10) NOT NULL CHECK (tipo IN ('TEXTO', 'URL', 'NUMERO', 'SEGREDO')),
  valor          text,            -- vazio = não configurado; segredos ficam em configuracao_segredo
  ordem          int NOT NULL DEFAULT 0,
  atualizado_em  timestamptz,     -- NULL = nunca alterado (aceita a importação inicial do .env.producao)
  atualizado_por uuid REFERENCES usuario(id)
);

-- Segredos (tokens de API), cifrados pela aplicação. Não aparecem para o usuário só de leitura (pgAdmin).
CREATE TABLE configuracao_segredo (
  chave         varchar(60) PRIMARY KEY REFERENCES configuracao(chave),
  valor_cifrado text
);

INSERT INTO configuracao (chave, grupo, rotulo, descricao, tipo, valor, ordem) VALUES
 ('pdv_monitor_segundos', 'MONITOR_PDV', 'Intervalo do teste (segundos)',
  'De quanto em quanto tempo o servidor testa a comunicação de cada PDV. 0 desliga o monitor.', 'NUMERO', '60', 1),
 ('pdv_porta_tcp', 'MONITOR_PDV', 'Porta TCP do teste',
  'Vazio = teste por ping. Se os PDVs bloqueiam ping, informe uma porta que eles sempre atendem (ex.: 3389, ou 10050 do agente Zabbix).', 'NUMERO', NULL, 2),
 ('zabbix_url', 'ZABBIX', 'Endereço do Zabbix',
  'Ex.: http://10.10.4.20/zabbix (a API fica em /api_jsonrpc.php). Vazio desliga a integração.', 'URL', NULL, 1),
 ('zabbix_token', 'ZABBIX', 'Token de API',
  'Token de um usuário só de leitura no Zabbix (Usuários > Tokens de API). Ao trocar o endereço, informe o token de novo.', 'SEGREDO', NULL, 2);
INSERT INTO configuracao_segredo (chave) VALUES ('zabbix_token');

-- Grupos de parâmetros que cada usuário pode alterar (o administrador altera todos)
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS parametro_grupos text[] NOT NULL DEFAULT '{}';

GRANT SELECT, INSERT, UPDATE ON configuracao, configuracao_segredo TO sisti_app;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisti_leitura') THEN
    GRANT SELECT ON configuracao TO sisti_leitura;
    REVOKE ALL ON configuracao_segredo FROM sisti_leitura;
    GRANT SELECT (parametro_grupos) ON sisti.usuario TO sisti_leitura;
  END IF;
END $$;
