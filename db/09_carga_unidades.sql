-- SisTI: carga das unidades da rede (origem: planilha lojas.xlsx).
-- Idempotente: rodar de novo atualiza os dados pelo código, sem duplicar.
-- Área (m²), quantidade de checkouts e "loja crítica" não vieram na planilha: completar em Cadastros base.
SET search_path = sisti, public;

INSERT INTO loja (codigo, nome_fantasia, razao_social, cnpj, tipo, endereco, erp_id) VALUES
  ('001', 'Supermercado Santarem - Cafezal', 'Supermercado Santarem Ltda', '75733147000190', 'SUPERMERCADO', '{"logradouro":"Av. Presidente Eurico Gaspar Dutra","bairro":"Conjunto Cafezal 2","cep":"86049-000","cidade":"Londrina","uf":"PR","telefone":"(43) 3342-3531","inscricao_estadual":"6010972300","nome_reduzido":"Cafezal"}'::jsonb, '001'),
  ('002', 'Supermercado Santarem - Figueira', 'Supermercado Santarem Ltda', '75733147000270', 'SUPERMERCADO', '{"logradouro":"Rua Figueira","bairro":"Jd. Santa Rita","cep":"86072-160","cidade":"Londrina","uf":"PR","telefone":"(43) 3338-8036","inscricao_estadual":"6010135255","nome_reduzido":"Figueira"}'::jsonb, '002'),
  ('003', 'Supermercado Santarem - Violim', 'Supermercado Santarem Ltda', '75733147000351', 'SUPERMERCADO', '{"logradouro":"Av. Saul Elkind","bairro":"Conj. Violim","cep":"86088-000","cidade":"Londrina","uf":"PR","telefone":"(43) 3326-4362","inscricao_estadual":"6011880906","nome_reduzido":"Violim"}'::jsonb, '003'),
  ('004', 'Supermercado Santarem - Parigot', 'Supermercado Santarem Ltda', '75733147000432', 'SUPERMERCADO', '{"logradouro":"Av. Saul Elkind","bairro":"Conj. Parigot","cep":"86082-000","cidade":"Londrina","uf":"PR","telefone":"(43) 3348-7921","inscricao_estadual":"6012055135","nome_reduzido":"Parigot"}'::jsonb, '004'),
  ('005', 'Supermercado Santarem - Sao Joao', 'Supermercado Santarem Ltda', '75733147000513', 'SUPERMERCADO', '{"logradouro":"Av. Sao Joao","bairro":"Conj. Belo Horizonte","cep":"86036-030","cidade":"Londrina","uf":"PR","telefone":"(43) 3321-9492","inscricao_estadual":"9058128152","nome_reduzido":"Sao Joao"}'::jsonb, '005'),
  ('006', 'Supermercado Santarem - Jardins', 'Supermercado Santarem Ltda', '75733147000602', 'SUPERMERCADO', '{"logradouro":"Rua Pio X.I.I.","bairro":"Centro","cep":"86020-380","cidade":"Londrina","uf":"PR","telefone":"(43) 3324-2047","inscricao_estadual":"9110078940","nome_reduzido":"Jardins"}'::jsonb, '006'),
  ('007', 'Supermercado Santarem - Sabara', 'Supermercado Santarem Ltda', '75733147000785', 'SUPERMERCADO', '{"logradouro":"Rua Elizio Turino","bairro":"Jardim Sabara","cep":"86066-240","cidade":"Londrina","uf":"PR","inscricao_estadual":"9114526506","nome_reduzido":"Sabara"}'::jsonb, '007'),
  ('098', 'Supermercado Santarem-C.D.', 'Supermercado Santarem Ltda', '75733147000947', 'CD', '{"logradouro":"Avenida Saul Elkind","bairro":"Cj. Vivi Xavier","cep":"86082-000","cidade":"Londrina","uf":"PR","telefone":"(43) 3348-7921","inscricao_estadual":"9118991599","nome_reduzido":"CD-Parigot 4080"}'::jsonb, '098'),
  ('099', 'Supermercado Santarem - Administrativo', 'Supermercado Santarem Ltda', '75733147000866', 'ESCRITORIO', '{"logradouro":"Av. Saul Elkind","bairro":"Jardim Santarem","cep":"86086-000","cidade":"Londrina","uf":"PR","nome_reduzido":"Administrativo"}'::jsonb, '099')
ON CONFLICT (codigo) DO UPDATE SET
  nome_fantasia = EXCLUDED.nome_fantasia, razao_social = EXCLUDED.razao_social, cnpj = EXCLUDED.cnpj,
  tipo = EXCLUDED.tipo, endereco = EXCLUDED.endereco, erp_id = EXCLUDED.erp_id;

SELECT codigo, nome_fantasia, tipo, cnpj FROM loja WHERE codigo IN ('001', '002', '003', '004', '005', '006', '007', '098', '099') ORDER BY codigo;
