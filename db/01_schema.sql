-- =====================================================================
-- SisTI - Controle de manutenção de equipamentos de TI
-- Modelo de dados (PostgreSQL 16+)
-- Execução: psql -d sisti -f 01_schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() e criptografia de CPF
CREATE SCHEMA IF NOT EXISTS sisti;
SET search_path = sisti, public;

-- ---------------------------------------------------------------------
-- Domínios (tipos enumerados)
-- ---------------------------------------------------------------------
CREATE TYPE status_equipamento AS ENUM (
  'ATIVO',                 -- operando na loja
  'AGUARDANDO_ORCAMENTO',  -- falha registrada, orçamento solicitado/em análise
  'EM_MANUTENCAO',         -- orçamento aprovado (ou preventiva), em reparo
  'TRANSITO',              -- em transporte entre loja, CD, fornecedor
  'EM_ESTOQUE',            -- novo ou devolvido, não instalado
  'EM_RESERVA',            -- contingência disponível na loja
  'SINISTRADO',            -- dano por evento externo (processo de seguro)
  'BAIXADO',               -- fora de uso, aguardando destinação
  'DESCARTADO'             -- destinação final com certificado
);
CREATE TYPE tipo_local      AS ENUM ('LOJA','CD','FORNECEDOR');
CREATE TYPE situacao_loja   AS ENUM ('ATIVA','EM_IMPLANTACAO','FECHADA');
CREATE TYPE tipo_chamado    AS ENUM ('CORRETIVA','PREVENTIVA','INSTALACAO','TROCA');
CREATE TYPE prioridade      AS ENUM ('BAIXA','MEDIA','ALTA','CRITICA');
CREATE TYPE status_orcamento AS ENUM ('RASCUNHO','SOLICITADO','RECEBIDO','EM_ANALISE',
                                      'APROVADO','REPROVADO','EXPIRADO','SUBSTITUIDO');
CREATE TYPE tipo_custo      AS ENUM ('PECA','MAO_DE_OBRA','FRETE','DESLOCAMENTO','OUTROS');

-- ---------------------------------------------------------------------
-- Cadastros base
-- ---------------------------------------------------------------------
CREATE TABLE loja (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          varchar(10)  NOT NULL UNIQUE,      -- código interno (igual ao ERP)
  nome_fantasia   varchar(120) NOT NULL,
  razao_social    varchar(160) NOT NULL,
  cnpj            char(14)     NOT NULL UNIQUE,
  tipo            varchar(30)  NOT NULL CHECK (tipo IN ('HIPERMERCADO','SUPERMERCADO','ATACAREJO','CONVENIENCIA','CD','ESCRITORIO')),
  area_m2         numeric(10,2) CHECK (area_m2 > 0),
  qtd_checkouts   int CHECK (qtd_checkouts >= 0), -- base do indicador custo por caixa
  endereco        jsonb,                          -- logradouro, número, cidade, UF, CEP
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  situacao        situacao_loja NOT NULL DEFAULT 'ATIVA',
  critica         boolean NOT NULL DEFAULT false, -- loja crítica: alerta de equipamento parado sem reserva
  erp_id          varchar(40) UNIQUE              -- chave no ERP, para integração
);

CREATE TABLE departamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        varchar(10)  NOT NULL UNIQUE,
  nome          varchar(80)  NOT NULL,           -- Caixa, Padaria, Açougue...
  centro_custo  varchar(30)  NOT NULL,           -- código do centro de custo no ERP
  ativo         boolean NOT NULL DEFAULT true
);

CREATE TABLE grupo_produto (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             varchar(10) NOT NULL UNIQUE,
  nome               varchar(80) NOT NULL,       -- Informática, Automação comercial, Balança...
  grupo_pai_id       uuid REFERENCES grupo_produto(id),
  vida_util_meses    int  CHECK (vida_util_meses > 0),
  taxa_depreciacao   numeric(5,2) CHECK (taxa_depreciacao BETWEEN 0 AND 100), -- % ao ano
  CHECK (grupo_pai_id IS DISTINCT FROM id)
);

CREATE TABLE marca (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome  varchar(80) NOT NULL UNIQUE
);

CREATE TABLE fabricante (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social    varchar(160) NOT NULL,
  cnpj            char(14) UNIQUE,               -- pode ser nulo para fabricante estrangeiro
  canal_garantia  jsonb                           -- telefone, e-mail, portal, prazo
);

-- Uma marca pode ter um ou mais fabricantes
CREATE TABLE marca_fabricante (
  marca_id       uuid NOT NULL REFERENCES marca(id),
  fabricante_id  uuid NOT NULL REFERENCES fabricante(id),
  PRIMARY KEY (marca_id, fabricante_id)
);

-- Produto = modelo de catálogo (não é a unidade física)
CREATE TABLE produto (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao         varchar(160) NOT NULL,
  modelo            varchar(80)  NOT NULL,
  marca_id          uuid NOT NULL,
  fabricante_id     uuid NOT NULL,
  grupo_id          uuid NOT NULL REFERENCES grupo_produto(id),
  sku_fabricante    varchar(60),
  especificacoes    jsonb,
  cor_padrao        varchar(30),
  vida_util_meses   int CHECK (vida_util_meses > 0),   -- se nulo, herda do grupo
  garantia_meses    int NOT NULL DEFAULT 12 CHECK (garantia_meses >= 0),
  ativo_catalogo    boolean NOT NULL DEFAULT true,
  -- a combinação marca x fabricante precisa existir
  FOREIGN KEY (marca_id, fabricante_id) REFERENCES marca_fabricante(marca_id, fabricante_id),
  UNIQUE (marca_id, modelo),
  -- permite que equipamento referencie (produto, marca, fabricante, grupo) com consistência garantida
  UNIQUE (id, marca_id, fabricante_id, grupo_id)
);

CREATE TABLE fornecedor (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social           varchar(160) NOT NULL,
  cnpj                   char(14) NOT NULL UNIQUE,
  tipos                  text[] NOT NULL CHECK (tipos <@ ARRAY['ASSISTENCIA','PECAS','FABRICANTE','TRANSPORTADORA']),
  contato                jsonb,
  sla_orcamento_dias     int CHECK (sla_orcamento_dias > 0),
  sla_reparo_dias        int CHECK (sla_reparo_dias > 0),
  garantia_servico_dias  int NOT NULL DEFAULT 90 CHECK (garantia_servico_dias >= 0),
  regioes                text[],
  homologado             boolean NOT NULL DEFAULT false, -- só homologado recebe ordem
  suspenso_motivo        text,
  erp_id                 varchar(40) UNIQUE
);

CREATE TABLE servico (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              varchar(30) NOT NULL CHECK (tipo IN ('DIAGNOSTICO','REPARO','TROCA_PECA','INSTALACAO','PREVENTIVA','CALIBRACAO','DESCARTE')),
  descricao         varchar(120) NOT NULL,
  unidade_cobranca  varchar(10) NOT NULL CHECK (unidade_cobranca IN ('HORA','EVENTO')),
  valor_referencia  numeric(12,2) CHECK (valor_referencia >= 0),
  sla_dias          int CHECK (sla_dias > 0)
);

CREATE TABLE categoria_falha (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo  varchar(20) NOT NULL UNIQUE,     -- ex.: BAL-CELULA, IMP-CABECA, PDV-FONTE
  nome    varchar(80) NOT NULL,
  grupo_id uuid REFERENCES grupo_produto(id)
);

-- ---------------------------------------------------------------------
-- Usuários e RBAC
-- ---------------------------------------------------------------------
CREATE TABLE perfil (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo varchar(30) NOT NULL UNIQUE,   -- ADMIN, GESTOR_TI, TECNICO, GERENTE_LOJA, COMPRAS, FORNECEDOR, AUDITORIA
  nome   varchar(60) NOT NULL,
  permissoes text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE usuario (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             varchar(120) NOT NULL,
  email            varchar(160) NOT NULL UNIQUE,
  login            varchar(60)  NOT NULL UNIQUE,
  cpf_cifrado      bytea,                      -- pgp_sym_encrypt; chave fora do banco
  telefone         varchar(20),
  perfil_id        uuid NOT NULL REFERENCES perfil(id),
  departamento_id  uuid REFERENCES departamento(id),
  fornecedor_id    uuid REFERENCES fornecedor(id), -- preenchido só para usuários do portal
  alcada_max       numeric(12,2) NOT NULL DEFAULT 0 CHECK (alcada_max >= 0),
  ativo            boolean NOT NULL DEFAULT true    -- inativo mantém histórico, não executa ações
);

-- Lojas que o usuário pode ver/operar (restrição por loja)
CREATE TABLE usuario_loja (
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  loja_id    uuid NOT NULL REFERENCES loja(id),
  PRIMARY KEY (usuario_id, loja_id)
);

-- ---------------------------------------------------------------------
-- Equipamento (unidade física)
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_codigo_interno;

CREATE TABLE equipamento (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- campos obrigatórios
  descricao          varchar(160) NOT NULL,
  numero_serie       varchar(80)  NOT NULL,   -- sem série: 'INT-' || nextval(seq_codigo_interno)
  serie_gerada       boolean NOT NULL DEFAULT false,
  produto_id         uuid NOT NULL,
  marca_id           uuid NOT NULL,
  fabricante_id      uuid NOT NULL,
  grupo_id           uuid NOT NULL,
  cor                varchar(30)  NOT NULL,
  departamento_id    uuid NOT NULL REFERENCES departamento(id),
  loja_id            uuid NOT NULL REFERENCES loja(id),   -- loja vinculada (dona do custo)
  status             status_equipamento NOT NULL DEFAULT 'EM_ESTOQUE',
  -- localização física (pode diferir da loja vinculada durante manutenção)
  local_tipo         tipo_local NOT NULL DEFAULT 'LOJA',
  local_loja_id      uuid REFERENCES loja(id),
  local_fornecedor_id uuid REFERENCES fornecedor(id),
  -- campos recomendados
  patrimonio         varchar(40) UNIQUE,
  qr_code            varchar(64) NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12),'hex'),
  data_aquisicao     date,
  nota_fiscal        varchar(60),
  valor_aquisicao    numeric(12,2) CHECK (valor_aquisicao >= 0),
  fornecedor_compra_id uuid REFERENCES fornecedor(id),
  garantia_inicio    date,
  garantia_fim       date,
  garantia_tipo      varchar(20) CHECK (garantia_tipo IN ('FABRICA','ESTENDIDA','CONTRATO')),
  setor_instalacao   varchar(80),
  ponto_instalacao   varchar(80),   -- ex.: Checkout 05
  ip                 inet,
  mac                macaddr,
  hostname           varchar(63),
  firmware_versao    varchar(40),
  reserva_id         uuid REFERENCES equipamento(id),   -- reserva vinculada
  responsavel_uso    varchar(120),
  versao             int NOT NULL DEFAULT 1,             -- controle otimista (sync offline)
  criado_em          timestamptz NOT NULL DEFAULT now(),
  -- consistência produto x marca x fabricante x grupo
  FOREIGN KEY (produto_id, marca_id, fabricante_id, grupo_id)
    REFERENCES produto(id, marca_id, fabricante_id, grupo_id),
  -- número de série único por produto
  UNIQUE (produto_id, numero_serie),
  CHECK (garantia_fim IS NULL OR garantia_inicio IS NULL OR garantia_fim >= garantia_inicio),
  CHECK (reserva_id IS DISTINCT FROM id),
  CHECK ( (local_tipo = 'LOJA' AND local_loja_id IS NOT NULL)
       OR (local_tipo = 'CD'   AND local_loja_id IS NOT NULL)
       OR (local_tipo = 'FORNECEDOR' AND local_fornecedor_id IS NOT NULL) )
);
CREATE INDEX ix_equip_loja_status ON equipamento (loja_id, status);
CREATE INDEX ix_equip_produto     ON equipamento (produto_id);

-- ---------------------------------------------------------------------
-- Ciclo de vida: transições permitidas (dados, não código)
-- ---------------------------------------------------------------------
CREATE TABLE transicao_status (
  de                       status_equipamento NOT NULL,
  para                     status_equipamento NOT NULL,
  exige_orcamento_ou_preventiva boolean NOT NULL DEFAULT false,
  exige_documento_transporte boolean NOT NULL DEFAULT false,
  exige_destino            boolean NOT NULL DEFAULT false,
  exige_confirmacao_receb  boolean NOT NULL DEFAULT false,
  exige_teste              boolean NOT NULL DEFAULT false,
  exige_aprovacao_gestor   boolean NOT NULL DEFAULT false,
  exige_motivo             boolean NOT NULL DEFAULT true,
  descricao                text,
  PRIMARY KEY (de, para)
);

-- ---------------------------------------------------------------------
-- Chamados (ordens de manutenção)
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_chamado;
CREATE TABLE chamado (
  id               uuid PRIMARY KEY,                -- gerado no aparelho (UUID) = chave de idempotência
  numero           bigint NOT NULL UNIQUE DEFAULT nextval('seq_chamado'),
  tipo             tipo_chamado NOT NULL,
  prioridade       prioridade NOT NULL DEFAULT 'MEDIA',
  equipamento_id   uuid NOT NULL REFERENCES equipamento(id),
  loja_id          uuid NOT NULL REFERENCES loja(id),
  categoria_falha_relatada_id   uuid REFERENCES categoria_falha(id), -- escolhida pela loja na abertura
  categoria_falha_id uuid REFERENCES categoria_falha(id),            -- confirmada pelo técnico (base da reincidência)
  relato           text NOT NULL,
  diagnostico      text,
  causa_raiz       text,
  em_garantia      boolean NOT NULL DEFAULT false,  -- calculado na abertura
  reincidente      boolean NOT NULL DEFAULT false,  -- calculado na abertura
  fornecedor_id    uuid REFERENCES fornecedor(id),
  tecnico_id       uuid REFERENCES usuario(id),
  solicitante_id   uuid NOT NULL REFERENCES usuario(id),
  situacao         varchar(20) NOT NULL DEFAULT 'ABERTO'
                   CHECK (situacao IN ('ABERTO','EM_ORCAMENTO','EM_REPARO','EM_RETORNO','ENCERRADO','CANCELADO')),
  aberto_em        timestamptz NOT NULL,            -- data do aparelho
  enviado_em       timestamptz,
  recebido_fornecedor_em timestamptz,
  orcamento_em     timestamptz,
  aprovado_em      timestamptz,
  reparo_inicio_em timestamptz,
  reparo_fim_em    timestamptz,
  retorno_loja_em  timestamptz,
  encerrado_em     timestamptz,
  teste_ok         boolean,
  satisfacao_nota  smallint CHECK (satisfacao_nota BETWEEN 1 AND 5)
);
CREATE INDEX ix_chamado_equip ON chamado (equipamento_id, aberto_em);
-- um único chamado corretivo aberto por equipamento
CREATE UNIQUE INDEX ux_chamado_aberto ON chamado (equipamento_id)
  WHERE situacao NOT IN ('ENCERRADO','CANCELADO') AND tipo = 'CORRETIVA';

-- ---------------------------------------------------------------------
-- Orçamentos (versionados; aprovado é imutável)
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_orcamento;
CREATE TABLE orcamento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          bigint NOT NULL DEFAULT nextval('seq_orcamento'),
  versao          int NOT NULL DEFAULT 1,
  chamado_id      uuid NOT NULL REFERENCES chamado(id),
  equipamento_id  uuid NOT NULL REFERENCES equipamento(id),
  fornecedor_id   uuid NOT NULL REFERENCES fornecedor(id),
  loja_id         uuid NOT NULL REFERENCES loja(id),
  solicitante_id  uuid NOT NULL REFERENCES usuario(id),
  valor_pecas     numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_pecas >= 0),
  valor_mao_obra  numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_mao_obra >= 0),
  valor_frete     numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_frete >= 0),
  valor_deslocamento numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor_deslocamento >= 0),
  valor_total     numeric(12,2) GENERATED ALWAYS AS
                  (valor_pecas + valor_mao_obra + valor_frete + valor_deslocamento) STORED,
  validade        date,
  condicoes_pagamento text,
  status          status_orcamento NOT NULL DEFAULT 'RASCUNHO',
  fornecedor_unico_justificativa text,
  aprovador_id    uuid REFERENCES usuario(id),
  decidido_em     timestamptz,
  justificativa_decisao text,
  anexo_id        uuid,                              -- PDF original
  UNIQUE (numero, versao),
  -- segregação de funções: quem solicita não aprova
  CHECK (aprovador_id IS NULL OR aprovador_id <> solicitante_id),
  CHECK (status NOT IN ('APROVADO','REPROVADO') OR (aprovador_id IS NOT NULL AND justificativa_decisao IS NOT NULL))
);
-- no máximo um orçamento aprovado por chamado
CREATE UNIQUE INDEX ux_orc_aprovado ON orcamento (chamado_id) WHERE status = 'APROVADO';

CREATE TABLE orcamento_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id   uuid NOT NULL REFERENCES orcamento(id),
  tipo           tipo_custo NOT NULL,
  servico_id     uuid REFERENCES servico(id),
  descricao      varchar(160) NOT NULL,
  quantidade     numeric(10,3) NOT NULL CHECK (quantidade > 0),
  valor_unitario numeric(12,2) NOT NULL CHECK (valor_unitario >= 0),
  valor_total    numeric(12,2) GENERATED ALWAYS AS (round(quantidade * valor_unitario, 2)) STORED
);

-- Faixas de alçada (parametrizáveis)
CREATE TABLE alcada (
  perfil_codigo varchar(30) NOT NULL,
  valor_ate     numeric(12,2),           -- nulo = sem limite
  PRIMARY KEY (perfil_codigo)
);

-- ---------------------------------------------------------------------
-- Movimentações de status (registro de anterior e atual)
-- ---------------------------------------------------------------------
CREATE TABLE movimentacao (
  id                 uuid PRIMARY KEY,               -- UUID do aparelho (idempotência)
  equipamento_id     uuid NOT NULL REFERENCES equipamento(id),
  status_anterior    status_equipamento NOT NULL,
  status_novo        status_equipamento NOT NULL,
  loja_origem_id     uuid REFERENCES loja(id),
  local_destino_tipo tipo_local,
  loja_destino_id    uuid REFERENCES loja(id),
  fornecedor_destino_id uuid REFERENCES fornecedor(id),
  chamado_id         uuid REFERENCES chamado(id),
  orcamento_id       uuid REFERENCES orcamento(id),
  documento_transporte varchar(60),                 -- NF de remessa ou romaneio
  motivo             text,
  observacao         text,
  usuario_id         uuid NOT NULL REFERENCES usuario(id),
  aprovador_id       uuid REFERENCES usuario(id),
  ocorrido_em        timestamptz NOT NULL,           -- relógio do aparelho
  registrado_em      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (status_anterior, status_novo) REFERENCES transicao_status(de, para)
);
CREATE INDEX ix_mov_equip ON movimentacao (equipamento_id, ocorrido_em);

-- ---------------------------------------------------------------------
-- Custos reais (append-only; correção por estorno)
-- ---------------------------------------------------------------------
CREATE TABLE custo_lancamento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipamento_id  uuid NOT NULL REFERENCES equipamento(id),
  loja_id         uuid NOT NULL REFERENCES loja(id),         -- loja na data do custo
  departamento_id uuid NOT NULL REFERENCES departamento(id), -- departamento na data do custo
  chamado_id      uuid REFERENCES chamado(id),
  orcamento_id    uuid REFERENCES orcamento(id),
  fornecedor_id   uuid REFERENCES fornecedor(id),
  tipo            tipo_custo NOT NULL,
  valor           numeric(12,2) NOT NULL,      -- negativo somente em estorno
  competencia     date NOT NULL,               -- mês de competência (dia 1)
  nfe_chave       char(44),
  estorno_de      uuid REFERENCES custo_lancamento(id),
  usuario_id      uuid NOT NULL REFERENCES usuario(id),
  registrado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK ( (estorno_de IS NULL AND valor >= 0) OR (estorno_de IS NOT NULL AND valor < 0) ),
  CHECK (competencia = date_trunc('month', competencia)::date)
);
CREATE INDEX ix_custo_equip ON custo_lancamento (equipamento_id);
CREATE INDEX ix_custo_loja_comp ON custo_lancamento (loja_id, competencia);

-- Fechamento mensal: competência fechada não aceita novos lançamentos
CREATE TABLE fechamento_mensal (
  competencia  date PRIMARY KEY,
  fechado_por  uuid NOT NULL REFERENCES usuario(id),
  fechado_em   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Eventos (histórico append-only) e anexos
-- ---------------------------------------------------------------------
CREATE TABLE evento (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo          varchar(50) NOT NULL,      -- STATUS_ALTERADO, ORCAMENTO_APROVADO, CUSTO_LANCADO, CADASTRO_ALTERADO...
  entidade      varchar(30) NOT NULL,      -- equipamento, chamado, orcamento...
  entidade_id   uuid NOT NULL,
  equipamento_id uuid,                     -- facilita a linha do tempo do equipamento
  payload       jsonb NOT NULL,            -- inclui valores anterior e novo
  usuario_id    uuid,
  origem        jsonb,                     -- IP, dispositivo, app/versão
  ocorrido_em   timestamptz NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_evento_equip ON evento (equipamento_id, ocorrido_em);
CREATE INDEX ix_evento_entidade ON evento (entidade, entidade_id);

CREATE TABLE anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade      varchar(30) NOT NULL,
  entidade_id   uuid NOT NULL,
  tipo          varchar(30) NOT NULL,      -- FOTO, LAUDO, NF, ORCAMENTO_PDF, CERTIFICADO_DESCARTE
  storage_key   text NOT NULL,             -- caminho no object storage
  sha256        char(64) NOT NULL,
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  registrado_em timestamptz NOT NULL DEFAULT now()
);

-- Parâmetros configuráveis (janelas, percentuais, prazos)
CREATE TABLE parametro (
  chave  varchar(60) PRIMARY KEY,
  valor  numeric NOT NULL,
  descricao text
);
