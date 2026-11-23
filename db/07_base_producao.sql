-- SisTI: cadastros básicos para começar em produção (sem dados fictícios).
-- Grupos de produto, categorias de falha e tipos de serviço genéricos de varejo.
-- Idempotente: não duplica nada se executado de novo. Ajuste depois pela tela Cadastros.
SET search_path = sisti, public;

INSERT INTO grupo_produto (codigo, nome, vida_util_meses, taxa_depreciacao) VALUES
 ('INF','Informática',48,20),('AUT','Automação comercial',60,20),('BAL','Balança',72,10),
 ('IMP','Impressão',48,20),('RED','Rede',60,20),('VID','Vídeo e segurança',60,20),('ENE','Energia',48,20)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO categoria_falha (codigo, nome, grupo_id)
SELECT c.codigo, c.nome, g.id FROM (VALUES
  ('PDV-FONTE','Fonte de alimentação','AUT'),('PDV-TOUCH','Tela touch','AUT'),('PDV-HD','Disco/SSD','AUT'),
  ('IMP-CABECA','Cabeça de impressão','IMP'),('IMP-GUILH','Guilhotina','IMP'),
  ('BAL-CELULA','Célula de carga','BAL'),('BAL-DISPLAY','Display','BAL'),
  ('RED-PORTA','Porta/PoE','RED'),('ENE-BATERIA','Bateria','ENE'),('GEN-OUTROS','Outros','INF')
) c(codigo, nome, grupo) JOIN grupo_produto g ON g.codigo = c.grupo
ON CONFLICT (codigo) DO NOTHING;

-- Serviços sem valor de referência (cada empresa informa o seu)
INSERT INTO servico (tipo, descricao, unidade_cobranca, sla_dias)
SELECT s.tipo, s.descricao, s.unidade, s.sla FROM (VALUES
  ('DIAGNOSTICO','Diagnóstico em bancada','EVENTO',2),
  ('REPARO','Reparo eletrônico','HORA',5),
  ('TROCA_PECA','Troca de peça','EVENTO',3),
  ('CALIBRACAO','Aferição de balança','EVENTO',5),
  ('PREVENTIVA','Limpeza preventiva','EVENTO',1),
  ('INSTALACAO','Instalação em loja','EVENTO',2)
) s(tipo, descricao, unidade, sla)
WHERE NOT EXISTS (SELECT 1 FROM servico x WHERE x.descricao = s.descricao);
