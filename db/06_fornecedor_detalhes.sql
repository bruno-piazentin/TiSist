-- SisTI: dados complementares do fornecedor (endereço, contatos e marcas representadas).
-- Idempotente: pode ser executado em banco novo (após 04_app.sql) ou em banco já em uso.
SET search_path = sisti, public;

ALTER TABLE fornecedor
  ADD COLUMN IF NOT EXISTS nome_fantasia         varchar(160),
  ADD COLUMN IF NOT EXISTS telefone              varchar(30),
  ADD COLUMN IF NOT EXISTS email                 varchar(160),
  -- endereço
  ADD COLUMN IF NOT EXISTS cep                   char(8) CHECK (cep ~ '^\d{8}$'),
  ADD COLUMN IF NOT EXISTS logradouro            varchar(160),
  ADD COLUMN IF NOT EXISTS numero                varchar(20),
  ADD COLUMN IF NOT EXISTS complemento           varchar(80),
  ADD COLUMN IF NOT EXISTS bairro                varchar(80),
  ADD COLUMN IF NOT EXISTS cidade                varchar(80),
  ADD COLUMN IF NOT EXISTS uf                    char(2) CHECK (uf ~ '^[A-Z]{2}$'),
  -- contato da assistência técnica
  ADD COLUMN IF NOT EXISTS assistencia_nome      varchar(120),
  ADD COLUMN IF NOT EXISTS assistencia_telefone  varchar(30),
  ADD COLUMN IF NOT EXISTS assistencia_email     varchar(160),
  -- contato do vendedor
  ADD COLUMN IF NOT EXISTS vendedor_nome         varchar(120),
  ADD COLUMN IF NOT EXISTS vendedor_telefone     varchar(30),
  ADD COLUMN IF NOT EXISTS vendedor_email        varchar(160),
  -- marcas que o fornecedor representa (lista editável; o papel da aplicação não tem DELETE)
  ADD COLUMN IF NOT EXISTS marcas_representadas  uuid[] NOT NULL DEFAULT '{}';

GRANT SELECT, INSERT, UPDATE ON fornecedor TO sisti_app;
