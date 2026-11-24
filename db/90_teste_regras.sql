-- =====================================================================
-- SisTI - Roteiro de teste do fluxo completo (dados fictícios)
-- Execução: npm run test:banco (cria um banco temporário só com 01_schema e 02_regras, roda este roteiro e apaga)
-- Os blocos "esperado: bloqueio" imprimem NOTICE 'OK bloqueado: ...'; se a regra deixar passar, aparece "FALHOU".
-- =====================================================================
SET search_path = sisti, public;

-- Cadastros mínimos ---------------------------------------------------
INSERT INTO loja (id, codigo, nome_fantasia, razao_social, cnpj, tipo, area_m2, qtd_checkouts) VALUES
 ('10000000-0000-0000-0000-000000000001','L01','Loja Centro','Rede Exemplo Ltda','11111111000101','SUPERMERCADO',1800,12),
 ('10000000-0000-0000-0000-000000000002','L02','Loja Bairro','Rede Exemplo Ltda','11111111000202','SUPERMERCADO',900,6);
INSERT INTO departamento (id, codigo, nome, centro_custo) VALUES
 ('20000000-0000-0000-0000-000000000001','CX','Caixa','CC-101');
INSERT INTO grupo_produto (id, codigo, nome, vida_util_meses) VALUES
 ('30000000-0000-0000-0000-000000000001','BAL','Balança',60);
INSERT INTO marca (id, nome) VALUES ('40000000-0000-0000-0000-000000000001','Marca X');
INSERT INTO fabricante (id, razao_social, cnpj) VALUES ('50000000-0000-0000-0000-000000000001','Fabricante X SA','22222222000100');
INSERT INTO marca_fabricante VALUES ('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
INSERT INTO produto (id, descricao, modelo, marca_id, fabricante_id, grupo_id, garantia_meses) VALUES
 ('60000000-0000-0000-0000-000000000001','Balança checkout 15kg','BX-15',
  '40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',12);
INSERT INTO fornecedor (id, razao_social, cnpj, tipos, homologado) VALUES
 ('70000000-0000-0000-0000-000000000001','Assistência Y Ltda','33333333000100','{ASSISTENCIA}',true);
INSERT INTO perfil (id, codigo, nome) VALUES
 ('80000000-0000-0000-0000-000000000001','TECNICO','Técnico de TI'),
 ('80000000-0000-0000-0000-000000000002','GESTOR_TI','Gestor de TI');
INSERT INTO usuario (id, nome, email, login, perfil_id, alcada_max) VALUES
 ('90000000-0000-0000-0000-000000000001','Técnico','t@ex.com','tec','80000000-0000-0000-0000-000000000001',0),
 ('90000000-0000-0000-0000-000000000002','Gestor', 'g@ex.com','ges','80000000-0000-0000-0000-000000000002',1000);
INSERT INTO categoria_falha (id, codigo, nome) VALUES
 ('a0000000-0000-0000-0000-000000000001','BAL-CELULA','Célula de carga');

-- Equipamento: marca/fabricante/grupo têm de bater com o produto ----------
INSERT INTO equipamento (id, descricao, numero_serie, produto_id, marca_id, fabricante_id, grupo_id, cor,
                         departamento_id, loja_id, status, local_tipo, local_loja_id, valor_aquisicao, garantia_fim)
VALUES ('b0000000-0000-0000-0000-000000000001','Balança checkout 05','SN-123',
        '60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Cinza',
        '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ATIVO','LOJA',
        '10000000-0000-0000-0000-000000000001', 2000, '2026-01-31');

-- esperado: bloqueio (número de série duplicado no mesmo produto)
DO $$ BEGIN
  INSERT INTO equipamento (descricao, numero_serie, produto_id, marca_id, fabricante_id, grupo_id, cor, departamento_id, loja_id, local_loja_id)
  SELECT 'Dup', 'SN-123', produto_id, marca_id, fabricante_id, grupo_id, cor, departamento_id, loja_id, local_loja_id
  FROM equipamento WHERE numero_serie='SN-123';
  RAISE EXCEPTION 'FALHOU: duplicidade aceita';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'OK bloqueado: série duplicada';
END $$;

-- esperado: bloqueio (troca de loja por edição direta)
DO $$ BEGIN
  UPDATE equipamento SET loja_id='10000000-0000-0000-0000-000000000002' WHERE numero_serie='SN-123';
  RAISE EXCEPTION 'FALHOU: troca direta aceita';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK bloqueado: %', SQLERRM;
END $$;

-- Fluxo corretivo ------------------------------------------------------
INSERT INTO chamado (id, tipo, prioridade, equipamento_id, loja_id, categoria_falha_id, relato, solicitante_id, aberto_em)
VALUES ('c0000000-0000-0000-0000-000000000001','CORRETIVA','ALTA','b0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Peso oscilando',
        '90000000-0000-0000-0000-000000000001', now());

SELECT fn_movimentar('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
       'AGUARDANDO_ORCAMENTO','90000000-0000-0000-0000-000000000001', now(), 'Chamado 1 aberto',
       p_chamado_id => 'c0000000-0000-0000-0000-000000000001');

-- idempotência: o mesmo UUID reenviado pelo app não duplica
SELECT fn_movimentar('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
       'AGUARDANDO_ORCAMENTO','90000000-0000-0000-0000-000000000001', now(), 'reenvio');

-- esperado: bloqueio (Em manutenção sem orçamento aprovado)
DO $$ BEGIN
  PERFORM fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','EM_MANUTENCAO',
          '90000000-0000-0000-0000-000000000001', now(), 'tentativa');
  RAISE EXCEPTION 'FALHOU';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK bloqueado: %', SQLERRM;
END $$;

INSERT INTO orcamento (id, chamado_id, equipamento_id, fornecedor_id, loja_id, solicitante_id,
                       valor_pecas, valor_mao_obra, valor_frete, status)
VALUES ('e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',
        450, 250, 60, 'RECEBIDO');

-- esperado: bloqueio (solicitante aprovando o próprio orçamento)
DO $$ BEGIN
  UPDATE orcamento SET status='APROVADO', aprovador_id='90000000-0000-0000-0000-000000000001',
         justificativa_decisao='ok' WHERE id='e0000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU';
EXCEPTION WHEN check_violation OR raise_exception THEN RAISE NOTICE 'OK bloqueado: segregação de funções';
END $$;

-- aprovação válida pelo gestor (alçada 1.000 >= 760)
UPDATE orcamento SET status='APROVADO', aprovador_id='90000000-0000-0000-0000-000000000002',
       justificativa_decisao='Reparo abaixo de 50% do valor de compra'
 WHERE id='e0000000-0000-0000-0000-000000000001';

-- esperado: bloqueio (orçamento aprovado é imutável)
DO $$ BEGIN
  UPDATE orcamento SET valor_pecas=10 WHERE id='e0000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK bloqueado: %', SQLERRM;
END $$;

SELECT fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','EM_MANUTENCAO',
       '90000000-0000-0000-0000-000000000001', now(), 'Orçamento aprovado',
       p_orcamento_id => 'e0000000-0000-0000-0000-000000000001', p_chamado_id => 'c0000000-0000-0000-0000-000000000001');

-- esperado: bloqueio (trânsito sem documento)
DO $$ BEGIN
  PERFORM fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','TRANSITO',
          '90000000-0000-0000-0000-000000000001', now(), 'envio', p_destino_tipo => 'FORNECEDOR',
          p_fornecedor_destino_id => '70000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FALHOU';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK bloqueado: %', SQLERRM;
END $$;

SELECT fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','TRANSITO',
       '90000000-0000-0000-0000-000000000001', now(), 'Envio ao fornecedor', p_destino_tipo => 'FORNECEDOR',
       p_fornecedor_destino_id => '70000000-0000-0000-0000-000000000001', p_documento => 'NF-REM 4512');
SELECT fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','EM_MANUTENCAO',
       '90000000-0000-0000-0000-000000000001', now(), 'Recebido pelo fornecedor',
       p_chamado_id => 'c0000000-0000-0000-0000-000000000001', p_confirmou_receb => true);
SELECT fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','TRANSITO',
       '90000000-0000-0000-0000-000000000001', now(), 'Retorno à loja', p_destino_tipo => 'LOJA',
       p_loja_destino_id => '10000000-0000-0000-0000-000000000001', p_documento => 'ROM 889');
SELECT fn_movimentar(gen_random_uuid(),'b0000000-0000-0000-0000-000000000001','ATIVO',
       '90000000-0000-0000-0000-000000000001', now(), 'Recebido e testado',
       p_confirmou_receb => true, p_teste_ok => true);

-- custo real (NF do fornecedor) com estorno de lançamento errado
INSERT INTO custo_lancamento (id, equipamento_id, loja_id, departamento_id, chamado_id, orcamento_id, fornecedor_id, tipo, valor, competencia, usuario_id)
SELECT 'f0000000-0000-0000-0000-000000000001', e.id, e.loja_id, e.departamento_id, 'c0000000-0000-0000-0000-000000000001',
       'e0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','PECA', 4500,
       date_trunc('month', now())::date, '90000000-0000-0000-0000-000000000002'
FROM equipamento e WHERE e.numero_serie='SN-123';
INSERT INTO custo_lancamento (equipamento_id, loja_id, departamento_id, tipo, valor, competencia, estorno_de, usuario_id)
SELECT equipamento_id, loja_id, departamento_id, tipo, -4500, competencia, id, '90000000-0000-0000-0000-000000000002'
FROM custo_lancamento WHERE id='f0000000-0000-0000-0000-000000000001';
INSERT INTO custo_lancamento (equipamento_id, loja_id, departamento_id, tipo, valor, competencia, usuario_id)
SELECT e.id, e.loja_id, e.departamento_id, t.tipo::tipo_custo, t.v, date_trunc('month', now())::date, '90000000-0000-0000-0000-000000000002'
FROM equipamento e, (VALUES ('PECA',450),('MAO_DE_OBRA',300),('FRETE',60)) t(tipo,v) WHERE e.numero_serie='SN-123';

-- esperado: bloqueio (custo não pode ser editado)
DO $$ BEGIN
  UPDATE custo_lancamento SET valor = 1 WHERE id='f0000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'OK bloqueado: %', SQLERRM;
END $$;

-- Resultados -----------------------------------------------------------
\echo '--- Movimentações (status anterior -> novo)'
SELECT status_anterior, status_novo, coalesce(documento_transporte,'') doc, motivo FROM movimentacao ORDER BY registrado_em, ocorrido_em;
\echo '--- Equipamento'
SELECT numero_serie, status, local_tipo, versao FROM equipamento;
\echo '--- Custo acumulado'
SELECT descricao, valor_aquisicao, custo_acumulado, pct_aquisicao, sugerir_substituicao FROM vw_custo_equipamento;
\echo '--- Custo por loja/mês'
SELECT nome_fantasia, custo_total, custo_por_m2, custo_por_checkout FROM vw_custo_loja_mes;
