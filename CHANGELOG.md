# Histórico de versões do SisTI

Cada versão tem um número **X.Y.Z**:
- **Z** sobe em correções (1.1.0 → 1.1.1);
- **Y** sobe em funções novas (1.1.1 → 1.2.0);
- **X** só sobe em mudanças grandes.

A versão instalada aparece no menu do usuário (canto superior direito) e no comando `sisti versao`.
Como publicar uma versão: veja "Publicar uma versão" em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## 1.2.0 (24/11/2026)

- **Bloqueio do login por senhas erradas:** depois de 3 senhas erradas seguidas, o usuário fica bloqueado por
  5 minutos (nem a senha certa entra nesse período). A tela avisa quando falta só uma tentativa.
- Os dois números podem ser ajustados na tela **Parâmetros** (`login_tentativas_max` e `login_bloqueio_minutos`).
- Na tela **Usuários**, o login bloqueado aparece como "bloqueado"; o administrador pode clicar em
  **Desbloquear agora** ou definir uma senha nova (que também desbloqueia).
- Bloqueios e desbloqueios ficam registrados no histórico (eventos `LOGIN_BLOQUEADO` e `LOGIN_DESBLOQUEADO`).
- Banco: script `db/12_bloqueio_login.sql` (aplicado automaticamente pelo `sisti atualizar`).

## 1.1.4 (23/11/2026)

**Manutenção do código** (sem mudança visível para quem usa o sistema)
- Banco de desenvolvimento montado com a mesma lista de scripts da produção (`db/migracoes.txt`); antes faltavam scripts, inclusive a correção de segurança da 1.1.1.
- Comandos de teste: `npm test` (API, 38 testes) e `npm run test:banco` (regras do banco em banco temporário, que agora acusa falha automaticamente).
- Validações e registro no histórico centralizados (`server/validacao.ts`, `server/evento.ts`), no lugar de cópias em vários arquivos.
- README com a estrutura atual, os testes e um guia para quem vai programar; melhorias futuras registradas em `docs/MELHORIAS-PENDENTES.md`.

## 1.1.3 (23/11/2026)

**Acessibilidade e uso no celular**
- Listas (equipamentos, chamados, cadastros): o registro também abre pelo teclado (Tab até a linha e Enter).
- Formulários: rótulos ligados aos campos (leitor de tela anuncia o nome e se é obrigatório; clicar no rótulo leva ao campo). Filtros com nome.
- Janelas: o foco entra na janela, o Tab não escapa para a página de trás e, ao fechar, volta ao botão que a abriu.
- Celular: campos com fonte de 16px (o iPhone não amplia mais a tela ao tocar) e botões e campos com 44px de altura.
- Cores com contraste adequado nos textos em cinza claro, nos títulos do menu e nas pílulas verde e azul.
- Avisos anunciados pelo leitor de tela; mensagens de erro ficam até serem fechadas.
- Cadastros no celular: lista de seleção no lugar das abas e só as colunas principais na tabela.
- Menu inferior do celular com até 5 itens (Aprovar só para quem aprova; Fila quando há pendência ou sem conexão). Aprovações, Custos e Fila também no menu do usuário.
- CNPJ formatado (00.000.000/0000-00) nas listas, relatórios e formulários.
- Login com botão de mostrar/ocultar a senha.
- Atalho "Pular para o conteúdo" para quem usa teclado, e foco no conteúdo ao trocar de tela.
- Respeita a opção "reduzir movimento" do aparelho.

## 1.1.2 (23/11/2026)

**Implantação**
- Acesso ao banco pelo pgAdmin via túnel SSH: a porta 5432 passa a existir só dentro do servidor (127.0.0.1), sem ficar exposta na rede. Passo a passo em docs/IMPLANTACAO.md, "Acessar o banco pelo pgAdmin".
- Usuário de banco só de leitura (`sisti_leitura`) para o pgAdmin: consulta todas as lojas, não grava nada nem vê senhas. A senha é gerada no servidor com `sisti leitura`.

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
