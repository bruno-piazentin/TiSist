# Histórico de versões do SisTI

Cada versão tem um número **X.Y.Z**:
- **Z** sobe em correções (1.1.0 → 1.1.1);
- **Y** sobe em funções novas (1.1.1 → 1.2.0);
- **X** só sobe em mudanças grandes.

A versão instalada aparece no menu do usuário (canto superior direito) e no comando `sisti versao`.
Como publicar uma versão: veja "Publicar uma versão" em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## 1.1.2 (23/11/2026)

**Implantação**
- Acesso ao banco pelo pgAdmin via túnel SSH: a porta 5432 passa a existir só dentro do servidor (127.0.0.1), sem ficar exposta na rede. Passo a passo em docs/IMPLANTACAO.md, "Acessar o banco pelo pgAdmin".

## 1.1.1 (23/11/2026)

**Correções de segurança**
- Gerente de loja e técnico deixam de ver, no painel, equipamentos e custos de lojas às quais não têm acesso (quadro "Custo próximo do valor de compra").
- Abertura de chamado pela sincronização offline passa a conferir a permissão do perfil: Auditoria, Diretoria, Compras e Administrador não abrem chamado também por esse caminho.

O `sisti atualizar` aplica sozinho o ajuste de banco desta versão (`db/10_visoes_restricao_loja.sql`).

## 1.1.0 (23/11/2026)

**Novo**
- **Agenda:** calendário mensal com visitas técnicas, preventivas, instalações, coletas/entregas e reuniões. Clique num dia para ver os agendamentos e criar um novo.
- **Layout novo:** ícone em cada aba do menu, que pode ser recolhido para mostrar só os ícones (o nome aparece ao passar o mouse). O painel do usuário fica no canto superior direito. Visual atualizado em todo o sistema, também no celular.
- **Unidades:** endereço e contato no cadastro (CEP, logradouro, número, bairro, cidade, UF, telefone, inscrição estadual). Carga das 9 unidades da rede.
- **Confirmação ao fechar** a aba do sistema.
- **Controle de versões:** versão visível no sistema, comandos `sisti versao` e `sisti atualizar [versão]`, backup automático antes de atualizar e banco atualizado sozinho.

**Correções**
- Relatórios (PDF) abrem direto a janela de impressão, sem abrir outra aba.
- HTTPS funcionando no acesso pelo IP do servidor.

**Implantação**
- Instalação em servidor Linux com Docker, HTTPS e backup diário (`instalar.sh`), e comando `sisti` de administração.

## 1.0.0 (23/11/2026)

Primeira entrega: equipamentos, chamados, movimentação entre lojas, CD e fornecedores, orçamentos e aprovações, custos, painel de indicadores, cadastros base, relatórios e funcionamento offline no celular.
