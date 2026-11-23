-- SisTI 1.1.1: visões passam a respeitar a restrição por loja (RLS) de quem consulta.
-- Sem security_invoker, a visão roda com as permissões do dono e mostrava equipamentos e custos
-- de todas as lojas para perfis restritos (gerente de loja, técnico).
-- vw_reincidencia_modelo continua com o cálculo da rede inteira de propósito: só traz totais por modelo
-- (sem loja nem equipamento) e o alerta de lote precisa considerar todas as lojas.
SET search_path = sisti, public;

ALTER VIEW vw_custo_equipamento SET (security_invoker = true);
ALTER VIEW vw_custo_loja_mes    SET (security_invoker = true);
ALTER VIEW vw_linha_tempo       SET (security_invoker = true);
