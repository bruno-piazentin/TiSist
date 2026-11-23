-- =====================================================================
-- SisTI - Dados de DEMONSTRAÇÃO (fictícios). Não executar em produção.
-- Cria 7 lojas, catálogo, usuários e ~12 meses de histórico sintético
-- para alimentar o dashboard.
-- Senha de todos os usuários de demonstração: sisti123
-- Execução: psql -d sisti -f 05_seed_demo.sql   (depois de 01, 02 e 04)
-- =====================================================================
SET search_path = sisti, public;
SELECT setseed(0.42);   -- dados reproduzíveis

-- Lojas ----------------------------------------------------------------
INSERT INTO loja (codigo, nome_fantasia, razao_social, cnpj, tipo, area_m2, qtd_checkouts, critica, endereco) VALUES
 ('L01','Loja Centro',        'Rede Demo Supermercados Ltda','10000000000101','SUPERMERCADO',2200,14,true ,'{"cidade":"Ribeirão Preto","uf":"SP"}'),
 ('L02','Loja Jardim',        'Rede Demo Supermercados Ltda','10000000000202','SUPERMERCADO',1500,10,true ,'{"cidade":"Ribeirão Preto","uf":"SP"}'),
 ('L03','Loja Vila Nova',     'Rede Demo Supermercados Ltda','10000000000303','SUPERMERCADO', 900, 6,false,'{"cidade":"Sertãozinho","uf":"SP"}'),
 ('L04','Atacarejo Rodovia',  'Rede Demo Supermercados Ltda','10000000000404','ATACAREJO',  4000,18,true ,'{"cidade":"Ribeirão Preto","uf":"SP"}'),
 ('L05','Loja Bonfim',        'Rede Demo Supermercados Ltda','10000000000505','SUPERMERCADO',1200, 8,false,'{"cidade":"Cravinhos","uf":"SP"}'),
 ('L06','Loja Alto da Boa Vista','Rede Demo Supermercados Ltda','10000000000606','SUPERMERCADO',1700,11,false,'{"cidade":"Ribeirão Preto","uf":"SP"}'),
 ('L07','Express Avenida',    'Rede Demo Supermercados Ltda','10000000000707','CONVENIENCIA', 350, 3,false,'{"cidade":"Ribeirão Preto","uf":"SP"}'),
 ('CD1','Centro de Distribuição','Rede Demo Supermercados Ltda','10000000000808','CD',     6000, 0,false,'{"cidade":"Ribeirão Preto","uf":"SP"}');

INSERT INTO departamento (codigo, nome, centro_custo) VALUES
 ('CX','Caixa','CC-110'),('PAD','Padaria','CC-120'),('ACO','Açougue','CC-130'),('HRT','Hortifruti','CC-140'),
 ('FRI','Frios','CC-150'),('ADM','Administrativo','CC-200'),('TI','TI','CC-210'),('ESC','Escritório','CC-220');

INSERT INTO grupo_produto (codigo, nome, vida_util_meses, taxa_depreciacao) VALUES
 ('INF','Informática',48,20),('AUT','Automação comercial',60,20),('BAL','Balança',72,10),
 ('IMP','Impressão',48,20),('RED','Rede',60,20),('VID','Vídeo e segurança',60,20),('ENE','Energia',48,20);

INSERT INTO marca (nome) VALUES ('Alfa'),('Beta'),('Gama'),('Delta'),('Omega');
INSERT INTO fabricante (razao_social, cnpj) VALUES
 ('Alfa Tecnologia SA','20000000000101'),('Beta Automação Ltda','20000000000202'),('Gama Pesagem Ltda','20000000000303'),
 ('Delta Redes SA','20000000000404'),('Omega Energia Ltda','20000000000505');
INSERT INTO marca_fabricante SELECT m.id, f.id FROM marca m JOIN fabricante f ON split_part(f.razao_social,' ',1) = m.nome;

INSERT INTO produto (descricao, modelo, marca_id, fabricante_id, grupo_id, garantia_meses, cor_padrao)
SELECT p.descricao, p.modelo, m.id, mf.fabricante_id, g.id, p.garantia, p.cor
FROM (VALUES
  ('PDV completo (CPU + monitor touch)','PDV-A10','Alfa','AUT',12,'Preto'),
  ('PDV compacto','PDV-B20','Beta','AUT',12,'Preto'),
  ('Impressora fiscal/não fiscal térmica','IT-300','Beta','IMP',12,'Preto'),
  ('Balança de checkout 15 kg','BC-15','Gama','BAL',12,'Cinza'),
  ('Balança etiquetadora','BE-30','Gama','BAL',12,'Branco'),
  ('Leitor de código de barras de mesa','LM-2D','Alfa','AUT',24,'Preto'),
  ('Impressora de etiquetas','IE-4','Beta','IMP',12,'Cinza'),
  ('Switch 24 portas','SW-24','Delta','RED',36,'Preto'),
  ('Roteador de loja','RT-1','Delta','RED',24,'Preto'),
  ('Microcomputador administrativo','MC-5','Alfa','INF',12,'Preto'),
  ('Nobreak 1,5 kVA','NB-15','Omega','ENE',12,'Preto'),
  ('Câmera IP','CAM-2','Delta','VID',12,'Branco')
) p(descricao, modelo, marca, grupo, garantia, cor)
JOIN marca m ON m.nome = p.marca
JOIN marca_fabricante mf ON mf.marca_id = m.id
JOIN grupo_produto g ON g.codigo = p.grupo;

INSERT INTO fornecedor (razao_social, cnpj, tipos, sla_orcamento_dias, sla_reparo_dias, garantia_servico_dias, homologado) VALUES
 ('TecPDV Assistência Técnica Ltda','30000000000101','{ASSISTENCIA}',2,7,90,true),
 ('Pesagem Center Ltda','30000000000202','{ASSISTENCIA,PECAS}',3,10,90,true),
 ('InfoRede Serviços Ltda','30000000000303','{ASSISTENCIA}',2,5,60,true),
 ('Rápido Transportes Ltda','30000000000404','{TRANSPORTADORA}',1,2,0,true),
 ('Conserta Tudo ME','30000000000505','{ASSISTENCIA}',5,15,30,false);

INSERT INTO servico (tipo, descricao, unidade_cobranca, valor_referencia, sla_dias) VALUES
 ('DIAGNOSTICO','Diagnóstico em bancada','EVENTO',120,2),
 ('REPARO','Reparo eletrônico','HORA',150,5),
 ('TROCA_PECA','Troca de peça','EVENTO',80,3),
 ('CALIBRACAO','Aferição de balança','EVENTO',250,5),
 ('PREVENTIVA','Limpeza preventiva','EVENTO',90,1),
 ('INSTALACAO','Instalação em loja','EVENTO',200,2);

INSERT INTO categoria_falha (codigo, nome, grupo_id)
SELECT c.codigo, c.nome, g.id FROM (VALUES
  ('PDV-FONTE','Fonte de alimentação','AUT'),('PDV-TOUCH','Tela touch','AUT'),('PDV-HD','Disco/SSD','AUT'),
  ('IMP-CABECA','Cabeça de impressão','IMP'),('IMP-GUILH','Guilhotina','IMP'),
  ('BAL-CELULA','Célula de carga','BAL'),('BAL-DISPLAY','Display','BAL'),
  ('RED-PORTA','Porta/PoE','RED'),('ENE-BATERIA','Bateria','ENE'),('GEN-OUTROS','Outros','INF')
) c(codigo, nome, grupo) JOIN grupo_produto g ON g.codigo = c.grupo;

-- Usuários (senha: sisti123) -------------------------------------------
INSERT INTO usuario (nome, email, login, perfil_id, departamento_id, alcada_max, senha_hash)
SELECT u.nome, u.login || '@rededemo.com.br', u.login, pf.id, d.id, u.alcada, crypt('sisti123', gen_salt('bf', 8))
FROM (VALUES
  ('Administrador','admin','ADMIN','TI',0),
  ('Gestora de TI','gestor','GESTOR_TI','TI',1000),
  ('Coordenador de TI','coordenador','COORDENADOR','TI',5000),
  ('Diretoria','diretoria','DIRETORIA','ADM',99999999),
  ('Técnico de TI','tecnico','TECNICO','TI',0),
  ('Gerente Loja Centro','gerente','GERENTE_LOJA','ADM',0),
  ('Compras e Financeiro','compras','COMPRAS','ADM',1000),
  ('Auditoria','auditoria','AUDITORIA','ADM',0)
) u(nome, login, perfil, depto, alcada)
JOIN perfil pf ON pf.codigo = u.perfil
JOIN departamento d ON d.codigo = u.depto;

-- Técnico atende L01 a L04; gerente vê só a L01
INSERT INTO usuario_loja SELECT u.id, l.id FROM usuario u, loja l WHERE u.login='tecnico' AND l.codigo IN ('L01','L02','L03','L04','CD1');
INSERT INTO usuario_loja SELECT u.id, l.id FROM usuario u, loja l WHERE u.login='gerente' AND l.codigo = 'L01';

-- Equipamentos -----------------------------------------------------------
-- Quantidade por loja proporcional aos checkouts
DO $$
DECLARE l record; p record; n int; i int; v_dep uuid; v_val numeric; v_aq date;
BEGIN
  FOR l IN SELECT * FROM loja WHERE tipo <> 'CD' LOOP
    FOR p IN SELECT pr.*, g.codigo AS grupo_cod FROM produto pr JOIN grupo_produto g ON g.id = pr.grupo_id LOOP
      n := CASE p.modelo
             WHEN 'PDV-A10' THEN CASE WHEN l.codigo IN ('L01','L02','L04') THEN l.qtd_checkouts ELSE 0 END
             WHEN 'PDV-B20' THEN CASE WHEN l.codigo IN ('L01','L02','L04') THEN 0 ELSE l.qtd_checkouts END
             WHEN 'IT-300'  THEN l.qtd_checkouts
             WHEN 'BC-15'   THEN l.qtd_checkouts
             WHEN 'LM-2D'   THEN l.qtd_checkouts
             WHEN 'BE-30'   THEN greatest(1, l.qtd_checkouts / 4)
             WHEN 'IE-4'    THEN greatest(1, l.qtd_checkouts / 6)
             WHEN 'SW-24'   THEN greatest(1, l.qtd_checkouts / 8)
             WHEN 'RT-1'    THEN 1
             WHEN 'MC-5'    THEN greatest(2, l.qtd_checkouts / 4)
             WHEN 'NB-15'   THEN greatest(1, l.qtd_checkouts / 5)
             WHEN 'CAM-2'   THEN greatest(4, l.qtd_checkouts / 2)
           END;
      FOR i IN 1..n LOOP
        v_dep := (SELECT id FROM departamento WHERE codigo = CASE
                    WHEN p.grupo_cod IN ('AUT','IMP') AND p.modelo <> 'IE-4' THEN 'CX'
                    WHEN p.modelo = 'BE-30' THEN (ARRAY['ACO','PAD','HRT','FRI'])[1 + (i % 4)]
                    WHEN p.modelo = 'BC-15' THEN 'CX'
                    WHEN p.modelo = 'IE-4'  THEN 'FRI'
                    WHEN p.grupo_cod IN ('RED','VID','ENE') THEN 'TI'
                    ELSE 'ADM' END);
        v_val := CASE p.grupo_cod WHEN 'AUT' THEN 3800 WHEN 'BAL' THEN 2600 WHEN 'IMP' THEN 1400
                   WHEN 'RED' THEN 1800 WHEN 'INF' THEN 3200 WHEN 'ENE' THEN 1600 ELSE 700 END;
        IF p.modelo = 'LM-2D' THEN v_val := 450; END IF;
        v_aq := current_date - (200 + floor(random() * 1100))::int;
        INSERT INTO equipamento (descricao, numero_serie, produto_id, marca_id, fabricante_id, grupo_id, cor,
             departamento_id, loja_id, status, local_tipo, local_loja_id, patrimonio, data_aquisicao,
             valor_aquisicao, garantia_inicio, garantia_fim, garantia_tipo, ponto_instalacao)
        VALUES (p.descricao || ' ' || lpad(i::text, 2, '0'),
             p.modelo || '-' || l.codigo || '-' || lpad(i::text, 3, '0'),
             p.id, p.marca_id, p.fabricante_id, p.grupo_id, coalesce(p.cor_padrao,'Preto'),
             v_dep, l.id, 'ATIVO', 'LOJA', l.id,
             'PAT-' || l.codigo || '-' || p.modelo || '-' || lpad(i::text, 3, '0'),
             v_aq, v_val, v_aq, v_aq + make_interval(months => p.garantia_meses), 'FABRICA',
             CASE WHEN p.grupo_cod IN ('AUT','IMP') OR p.modelo = 'BC-15' THEN 'Checkout ' || lpad(i::text, 2, '0') END);
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Reservas em estoque no CD
INSERT INTO equipamento (descricao, numero_serie, produto_id, marca_id, fabricante_id, grupo_id, cor, departamento_id,
                         loja_id, status, local_tipo, local_loja_id, valor_aquisicao, data_aquisicao)
SELECT p.descricao || ' (reserva)', p.modelo || '-CD1-R' || g, p.id, p.marca_id, p.fabricante_id, p.grupo_id, 'Preto',
       (SELECT id FROM departamento WHERE codigo='TI'), l.id, 'EM_ESTOQUE', 'CD', l.id, 3000, current_date - 60
FROM produto p, loja l, generate_series(1,2) g
WHERE l.codigo = 'CD1' AND p.modelo IN ('PDV-A10','IT-300','BC-15');

-- Histórico sintético de 12 meses ----------------------------------------
-- Chamados encerrados com orçamento aprovado e custo real lançado.
-- O modelo BC-15 recebe mais falhas de célula de carga (reincidência de modelo).
DO $$
DECLARE
  e record; v_ch uuid; v_orc uuid; v_ab timestamptz; v_cat uuid; v_forn uuid;
  v_pecas numeric; v_mo numeric; v_frete numeric; v_aprov uuid; v_tec uuid; v_ger uuid; v_k int; v_prob numeric;
BEGIN
  SELECT id INTO v_tec FROM usuario WHERE login='tecnico';
  SELECT id INTO v_ger FROM usuario WHERE login='gerente';
  FOR e IN SELECT eq.*, pr.modelo, g.codigo AS grupo_cod, l.codigo AS loja_cod
             FROM equipamento eq JOIN produto pr ON pr.id = eq.produto_id
             JOIN grupo_produto g ON g.id = eq.grupo_id JOIN loja l ON l.id = eq.loja_id
            WHERE eq.status = 'ATIVO' LOOP
    -- probabilidade anual de falha por modelo (fictícia)
    v_prob := CASE e.modelo WHEN 'BC-15' THEN 1.4 WHEN 'IT-300' THEN 0.9 WHEN 'PDV-B20' THEN 0.8 WHEN 'PDV-A10' THEN 0.5
                WHEN 'BE-30' THEN 0.6 WHEN 'NB-15' THEN 0.5 WHEN 'IE-4' THEN 0.6 ELSE 0.15 END;
    IF e.loja_cod = 'L04' THEN v_prob := v_prob * 1.4; END IF;   -- atacarejo: uso mais intenso
    FOR v_k IN 1..3 LOOP
      CONTINUE WHEN random() > v_prob / 2;
      v_ab := now() - make_interval(days => (15 + floor(random() * 340))::int, hours => floor(random()*10)::int);
      -- sazonalidade: nobreak falha mais de dezembro a março
      IF e.modelo = 'NB-15' AND extract(month FROM v_ab) BETWEEN 4 AND 11 AND random() < 0.6 THEN CONTINUE; END IF;
      v_cat := (SELECT c.id FROM categoria_falha c
                 WHERE c.grupo_id = e.grupo_id OR (c.codigo = 'GEN-OUTROS')
                 ORDER BY CASE WHEN e.modelo = 'BC-15' AND c.codigo = 'BAL-CELULA' THEN random() * 0.3 ELSE random() END
                 LIMIT 1);
      v_forn := (SELECT id FROM fornecedor WHERE razao_social = CASE
                   WHEN e.grupo_cod = 'BAL' THEN 'Pesagem Center Ltda'
                   WHEN e.grupo_cod IN ('RED','INF','VID','ENE') THEN 'InfoRede Serviços Ltda'
                   ELSE 'TecPDV Assistência Técnica Ltda' END);
      v_pecas := round((80 + random() * CASE e.grupo_cod WHEN 'AUT' THEN 900 WHEN 'BAL' THEN 700 ELSE 450 END)::numeric, 2);
      v_mo    := round((90 + random() * 260)::numeric, 2);
      v_frete := CASE WHEN random() < 0.6 THEN round((35 + random() * 60)::numeric, 2) ELSE 0 END;
      v_aprov := (SELECT id FROM usuario WHERE login = CASE WHEN v_pecas + v_mo + v_frete <= 1000 THEN 'gestor' ELSE 'coordenador' END);
      v_ch := gen_random_uuid();
      INSERT INTO chamado (id, tipo, prioridade, equipamento_id, loja_id, categoria_falha_relatada_id, categoria_falha_id,
                           relato, diagnostico, causa_raiz, fornecedor_id, tecnico_id, solicitante_id, aberto_em)
      VALUES (v_ch, 'CORRETIVA', (ARRAY['MEDIA','ALTA','CRITICA','BAIXA'])[1 + floor(random()*4)::int]::prioridade,
              e.id, e.loja_id, v_cat, v_cat, 'Falha registrada pela loja (histórico de demonstração)',
              'Diagnóstico de bancada', 'Desgaste de componente', v_forn, v_tec, v_ger, v_ab);
      v_orc := gen_random_uuid();
      INSERT INTO orcamento (id, chamado_id, equipamento_id, fornecedor_id, loja_id, solicitante_id,
                             valor_pecas, valor_mao_obra, valor_frete, status, aprovador_id, decidido_em, justificativa_decisao, validade)
      VALUES (v_orc, v_ch, e.id, v_forn, e.loja_id, v_tec, v_pecas, v_mo, v_frete, 'APROVADO', v_aprov,
              v_ab + interval '2 days', 'Reparo viável', (v_ab + interval '15 days')::date);
      INSERT INTO custo_lancamento (equipamento_id, loja_id, departamento_id, chamado_id, orcamento_id, fornecedor_id, tipo, valor, competencia, usuario_id, registrado_em)
      SELECT e.id, e.loja_id, e.departamento_id, v_ch, v_orc, v_forn, t.tipo::tipo_custo,
             round((t.v * (0.95 + random() * 0.15))::numeric, 2),
             date_trunc('month', v_ab + interval '8 days')::date,
             (SELECT id FROM usuario WHERE login='compras'), v_ab + interval '9 days'
      FROM (VALUES ('PECA', v_pecas), ('MAO_DE_OBRA', v_mo), ('FRETE', v_frete)) t(tipo, v) WHERE t.v > 0;
      UPDATE chamado SET situacao = 'ENCERRADO', teste_ok = true,
             enviado_em = v_ab + interval '1 day', recebido_fornecedor_em = v_ab + interval '2 days',
             orcamento_em = v_ab + interval '2 days', aprovado_em = v_ab + interval '2 days',
             reparo_inicio_em = v_ab + interval '3 days', reparo_fim_em = v_ab + make_interval(days => 4 + floor(random()*6)::int),
             retorno_loja_em = v_ab + make_interval(days => 6 + floor(random()*8)::int),
             encerrado_em = v_ab + make_interval(days => 7 + floor(random()*8)::int),
             satisfacao_nota = 3 + floor(random() * 3)::int
       WHERE id = v_ch;
    END LOOP;
  END LOOP;
END $$;

-- Situação atual: alguns equipamentos em andamento -------------------------
-- (usa fn_movimentar, respeitando todas as regras de transição)
DO $$
DECLARE e record; v_ch uuid; v_orc uuid; v_tec uuid; v_ges uuid; v_ger uuid; v_cat uuid; v_forn uuid; i int := 0;
BEGIN
  SELECT id INTO v_tec FROM usuario WHERE login='tecnico';
  SELECT id INTO v_ges FROM usuario WHERE login='gestor';
  SELECT id INTO v_ger FROM usuario WHERE login='gerente';
  PERFORM set_config('sisti.usuario_id', v_tec::text, true);
  FOR e IN SELECT eq.* , pr.modelo FROM equipamento eq JOIN produto pr ON pr.id = eq.produto_id
            WHERE eq.status = 'ATIVO' AND pr.modelo IN ('BC-15','IT-300','PDV-B20','PDV-A10','NB-15')
            ORDER BY eq.numero_serie LIMIT 9 OFFSET 3 LOOP
    i := i + 1;
    v_cat  := (SELECT id FROM categoria_falha WHERE grupo_id = e.grupo_id ORDER BY codigo LIMIT 1);
    v_forn := (SELECT id FROM fornecedor WHERE razao_social LIKE CASE WHEN e.modelo = 'BC-15' THEN 'Pesagem%' ELSE 'TecPDV%' END);
    v_ch := gen_random_uuid();
    INSERT INTO chamado (id, tipo, prioridade, equipamento_id, loja_id, categoria_falha_relatada_id, relato, solicitante_id, fornecedor_id, aberto_em)
    VALUES (v_ch, 'CORRETIVA', (CASE WHEN i % 3 = 0 THEN 'CRITICA' ELSE 'ALTA' END)::prioridade, e.id, e.loja_id, v_cat,
            'Equipamento com falha intermitente', v_ger, v_forn, now() - make_interval(days => 3 + i * 2));
    PERFORM fn_movimentar(gen_random_uuid(), e.id, 'AGUARDANDO_ORCAMENTO', v_tec, now() - make_interval(days => 3 + i * 2),
                          'Chamado aberto', p_chamado_id => v_ch);
    UPDATE chamado SET situacao = 'EM_ORCAMENTO' WHERE id = v_ch;
    CONTINUE WHEN i <= 3;                      -- 3 ficam aguardando orçamento
    v_orc := gen_random_uuid();
    INSERT INTO orcamento (id, chamado_id, equipamento_id, fornecedor_id, loja_id, solicitante_id,
                           valor_pecas, valor_mao_obra, valor_frete, status, validade)
    VALUES (v_orc, v_ch, e.id, v_forn, e.loja_id, v_tec, 300 + i * 40, 180, 50, 'RECEBIDO', current_date + 10);
    CONTINUE WHEN i <= 5;                      -- 2 com orçamento pendente de aprovação
    UPDATE orcamento SET status = 'APROVADO', aprovador_id = v_ges, justificativa_decisao = 'Reparo viável' WHERE id = v_orc;
    UPDATE chamado SET aprovado_em = now() - make_interval(days => i), situacao = 'EM_REPARO' WHERE id = v_ch;
    PERFORM fn_movimentar(gen_random_uuid(), e.id, 'EM_MANUTENCAO', v_tec, now() - make_interval(days => i),
                          'Orçamento aprovado', p_orcamento_id => v_orc, p_chamado_id => v_ch);
    CONTINUE WHEN i <= 6;                      -- 1 em manutenção na loja
    PERFORM fn_movimentar(gen_random_uuid(), e.id, 'TRANSITO', v_tec, now() - make_interval(days => i - 1),
                          'Envio ao fornecedor', p_destino_tipo => 'FORNECEDOR', p_fornecedor_destino_id => v_forn,
                          p_documento => 'NF-REM ' || (4500 + i));
    UPDATE chamado SET enviado_em = now() - make_interval(days => i - 1) WHERE id = v_ch;
    CONTINUE WHEN i <= 7;                      -- 1 em trânsito
    PERFORM fn_movimentar(gen_random_uuid(), e.id, 'EM_MANUTENCAO', v_tec, now() - make_interval(days => i - 2),
                          'Recebido pelo fornecedor', p_chamado_id => v_ch, p_confirmou_receb => true);
    UPDATE chamado SET recebido_fornecedor_em = now() - make_interval(days => i - 2) WHERE id = v_ch;
  END LOOP;
END $$;

-- Fecha competências anteriores ao mês corrente (exceto o mês passado)
INSERT INTO fechamento_mensal (competencia, fechado_por)
SELECT DISTINCT competencia, (SELECT id FROM usuario WHERE login='compras')
FROM custo_lancamento WHERE competencia < date_trunc('month', now() - interval '1 month')::date;
