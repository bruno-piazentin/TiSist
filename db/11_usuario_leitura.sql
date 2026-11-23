-- SisTI 1.1.2: usuário de banco só de leitura, para consultas pelo pgAdmin.
-- Lê todas as tabelas de todas as lojas, mas não grava nada nem vê as senhas dos usuários.
-- Nasce sem senha (não entra): a senha é gerada no servidor com "sisti leitura".
SET search_path = sisti, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisti_leitura') THEN
    CREATE ROLE sisti_leitura LOGIN;
  END IF;
END $$;

-- Consulta todas as lojas (a restrição por loja é para os usuários do sistema, não para a TI)
ALTER ROLE sisti_leitura BYPASSRLS;
-- Mesmo que alguma permissão escape, a sessão só lê; consultas longas são interrompidas
ALTER ROLE sisti_leitura SET default_transaction_read_only = on;
ALTER ROLE sisti_leitura SET statement_timeout = '120s';
ALTER ROLE sisti_leitura SET search_path = sisti, public;

DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO sisti_leitura', current_database()); END $$;
GRANT USAGE ON SCHEMA sisti TO sisti_leitura;
GRANT SELECT ON ALL TABLES IN SCHEMA sisti TO sisti_leitura;
DO $$ BEGIN
  IF to_regclass('public.sisti_migracao') IS NOT NULL THEN GRANT SELECT ON public.sisti_migracao TO sisti_leitura; END IF;
END $$;
-- Tabelas criadas em versões futuras também ficam legíveis
ALTER DEFAULT PRIVILEGES IN SCHEMA sisti GRANT SELECT ON TABLES TO sisti_leitura;

-- Usuários: todas as colunas, menos o hash da senha
REVOKE SELECT ON usuario FROM sisti_leitura;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'sisti' AND table_name = 'usuario' AND column_name <> 'senha_hash';
  EXECUTE format('GRANT SELECT (%s) ON sisti.usuario TO sisti_leitura', cols);
END $$;
