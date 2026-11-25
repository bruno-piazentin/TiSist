-- SisTI 1.5.0: "Excluir" nos cadastros base = inativar. O registro some das listas e não pode ser escolhido em
-- cadastros novos, mas continua existindo: histórico, relatórios, custos e movimentações antigas não mudam.
SET search_path = sisti, public;

-- Situação ativo/inativo nos cadastros que ainda não tinham (departamento já tem "ativo"; modelo usa "ativo_catalogo")
ALTER TABLE loja            ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE grupo_produto   ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE marca           ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE fabricante      ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE fornecedor      ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE servico         ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE categoria_falha ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- Impede escolher um cadastro inativo. Vale para qualquer caminho (tela, sincronização offline, importação).
-- Só confere quando o valor é novo (INSERT) ou mudou (UPDATE): registros antigos que já apontam para o
-- cadastro inativo continuam funcionando normalmente.
-- Argumentos: coluna, tabela referenciada, coluna de situação, coluna do nome, descrição ("O grupo").
CREATE OR REPLACE FUNCTION fn_ref_ativa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sisti, public AS $$
DECLARE
  novo uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  ativo boolean;
  nome text;
BEGIN
  IF novo IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND novo IS NOT DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[0])::uuid THEN RETURN NEW; END IF;
  EXECUTE format('SELECT %I, %I::text FROM %I WHERE id = $1', TG_ARGV[2], TG_ARGV[3], TG_ARGV[1]) INTO ativo, nome USING novo;
  IF ativo IS FALSE THEN
    RAISE EXCEPTION '% "%" foi excluído (está inativo) e não pode ser escolhido. Se precisar, reative em Cadastros base.', TG_ARGV[4], nome;
  END IF;
  RETURN NEW;
END $$;

-- Cadastros
CREATE TRIGGER tg_produto_marca_ativa  BEFORE INSERT OR UPDATE OF marca_id ON produto
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('marca_id', 'marca', 'ativo', 'nome', 'A marca');
CREATE TRIGGER tg_produto_fabr_ativo   BEFORE INSERT OR UPDATE OF fabricante_id ON produto
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('fabricante_id', 'fabricante', 'ativo', 'razao_social', 'O fabricante');
CREATE TRIGGER tg_produto_grupo_ativo  BEFORE INSERT OR UPDATE OF grupo_id ON produto
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('grupo_id', 'grupo_produto', 'ativo', 'nome', 'O grupo');
CREATE TRIGGER tg_grupo_pai_ativo      BEFORE INSERT OR UPDATE OF grupo_pai_id ON grupo_produto
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('grupo_pai_id', 'grupo_produto', 'ativo', 'nome', 'O grupo');
CREATE TRIGGER tg_categoria_grupo_ativo BEFORE INSERT OR UPDATE OF grupo_id ON categoria_falha
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('grupo_id', 'grupo_produto', 'ativo', 'nome', 'O grupo');
CREATE TRIGGER tg_usuario_loja_ativa   BEFORE INSERT ON usuario_loja
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('loja_id', 'loja', 'ativo', 'nome_fantasia', 'A loja');
CREATE TRIGGER tg_usuario_depto_ativo  BEFORE INSERT OR UPDATE OF departamento_id ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('departamento_id', 'departamento', 'ativo', 'nome', 'O departamento');

-- Equipamentos (a loja só é conferida no cadastro: depois ela muda pelas movimentações)
CREATE TRIGGER tg_equip_loja_ativa     BEFORE INSERT ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('loja_id', 'loja', 'ativo', 'nome_fantasia', 'A loja');
CREATE TRIGGER tg_equip_depto_ativo    BEFORE INSERT OR UPDATE OF departamento_id ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('departamento_id', 'departamento', 'ativo', 'nome', 'O departamento');
CREATE TRIGGER tg_equip_produto_ativo  BEFORE INSERT OR UPDATE OF produto_id ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('produto_id', 'produto', 'ativo_catalogo', 'modelo', 'O modelo');
CREATE TRIGGER tg_equip_forn_compra_ativo BEFORE INSERT OR UPDATE OF fornecedor_compra_id ON equipamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('fornecedor_compra_id', 'fornecedor', 'ativo', 'razao_social', 'O fornecedor');

-- Envio em trânsito: o destino escolhido precisa estar ativo
CREATE TRIGGER tg_mov_loja_destino_ativa BEFORE INSERT ON movimentacao
  FOR EACH ROW WHEN (NEW.status_novo = 'TRANSITO')
  EXECUTE FUNCTION fn_ref_ativa('loja_destino_id', 'loja', 'ativo', 'nome_fantasia', 'A loja');
CREATE TRIGGER tg_mov_forn_destino_ativo BEFORE INSERT ON movimentacao
  FOR EACH ROW WHEN (NEW.status_novo = 'TRANSITO')
  EXECUTE FUNCTION fn_ref_ativa('fornecedor_destino_id', 'fornecedor', 'ativo', 'razao_social', 'O fornecedor');

-- Chamados, orçamentos, agenda e PDVs
CREATE TRIGGER tg_chamado_cat_rel_ativa BEFORE INSERT OR UPDATE OF categoria_falha_relatada_id ON chamado
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('categoria_falha_relatada_id', 'categoria_falha', 'ativo', 'nome', 'A categoria de falha');
CREATE TRIGGER tg_chamado_cat_ativa    BEFORE INSERT OR UPDATE OF categoria_falha_id ON chamado
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('categoria_falha_id', 'categoria_falha', 'ativo', 'nome', 'A categoria de falha');
CREATE TRIGGER tg_chamado_forn_ativo   BEFORE INSERT OR UPDATE OF fornecedor_id ON chamado
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('fornecedor_id', 'fornecedor', 'ativo', 'razao_social', 'O fornecedor');
CREATE TRIGGER tg_orc_forn_ativo       BEFORE INSERT OR UPDATE OF fornecedor_id ON orcamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('fornecedor_id', 'fornecedor', 'ativo', 'razao_social', 'O fornecedor');
CREATE TRIGGER tg_orc_item_serv_ativo  BEFORE INSERT ON orcamento_item
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('servico_id', 'servico', 'ativo', 'descricao', 'O serviço');
CREATE TRIGGER tg_agenda_loja_ativa    BEFORE INSERT OR UPDATE OF loja_id ON agendamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('loja_id', 'loja', 'ativo', 'nome_fantasia', 'A loja');
CREATE TRIGGER tg_agenda_forn_ativo    BEFORE INSERT OR UPDATE OF fornecedor_id ON agendamento
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('fornecedor_id', 'fornecedor', 'ativo', 'razao_social', 'O fornecedor');
CREATE TRIGGER tg_pdv_loja_ativa       BEFORE INSERT OR UPDATE OF loja_id ON pdv
  FOR EACH ROW EXECUTE FUNCTION fn_ref_ativa('loja_id', 'loja', 'ativo', 'nome_fantasia', 'A loja');
