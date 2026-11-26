# Histórico de versões do SisTI

Cada versão tem um número **X.Y.Z**:
- **Z** sobe em correções (1.1.0 → 1.1.1);
- **Y** sobe em funções novas (1.1.1 → 1.2.0);
- **X** só sobe em mudanças grandes.

A versão instalada aparece no menu do usuário (canto superior direito) e no comando `sisti versao`.
Como publicar uma versão: veja "Publicar uma versão" em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## 1.5.2 (26/11/2026)

- **Cor do equipamento deixa de ser obrigatória** no cadastro e na edição. Sem cor, a ficha mostra "—".
- Banco: script `db/16_cor_opcional.sql` (aplicado automaticamente pelo `sisti atualizar`).

## 1.5.1 (25/11/2026)

- **Ícone do SisTI para atalho no Windows** (`sisti.ico`, com versão própria para tamanhos pequenos) e script
  `deploy/windows/criar-atalho.ps1`, que cria o atalho "SisTI" na área de trabalho abrindo o sistema em janela própria.
- **Aviso de SisTI já aberto:** ao abrir o sistema com outra janela ou aba dele já aberta no mesmo navegador, aparece
  o aviso "O SisTI já está aberto", com as opções Fechar esta janela ou Continuar nesta janela.
- Ícones PNG (192 e 512 px) no manifesto: o "Instalar SisTI" do Edge/Chrome passa a usar o ícone correto no Windows.

## 1.5.0 (24/11/2026)

- **Excluir nos cadastros base** (unidades, departamentos, grupos, marcas, fabricantes, modelos, fornecedores, serviços
  e categorias de falha). A exclusão **não apaga** o registro: ele fica inativo, some das listas e das opções de escolha,
  e não pode ser usado em cadastros novos. Equipamentos, chamados, custos, movimentações e relatórios que já o usam
  continuam iguais.
- Antes de excluir, a tela mostra onde o registro é usado. **Loja** com equipamentos ou PDVs ativos e **fornecedor** com
  equipamentos, chamados ou orçamentos em andamento não podem ser excluídos até isso ser resolvido.
- "Mostrar excluídos" na lista permite consultar e **Reativar** o registro. Exclusões e reativações ficam no histórico.
- O banco recusa escolher um cadastro excluído por qualquer caminho (tela, sincronização offline ou importação).
- Departamentos e modelos: os campos "Ativo" e "Ativo no catálogo" foram substituídos pelos botões Excluir/Reativar.
- Banco: script `db/15_cadastro_inativo.sql` (aplicado automaticamente pelo `sisti atualizar`).

## 1.4.0 (24/11/2026)

- **Configurações na tela Parâmetros:** endereço e token do Zabbix, intervalo e porta do monitor de PDVs passam a ser
  alterados na tela (antes, só no `.env.producao` do servidor) e valem na hora, sem reiniciar. Botão **Testar conexão**
  do Zabbix e situação do último teste de cada integração.
- Seção **Servidor** (somente leitura): versão, endereço de acesso, certificado, banco (sem senha), sessão, backup e fuso.
- **Permissão por usuário:** no cadastro do usuário, o administrador marca quais grupos de parâmetros ele pode alterar
  (Regras de manutenção, Login e segurança, Monitor de PDVs, Zabbix). Quem não tem permissão vê as regras só para leitura.
- Segurança: o token do Zabbix fica cifrado no banco, nunca volta para a tela nem aparece para o usuário de leitura
  (pgAdmin); trocar o endereço do Zabbix apaga o token salvo. Toda alteração fica no histórico de auditoria.
- Na atualização, os valores de `PDV_MONITOR_SEGUNDOS`, `PDV_PORTA_TCP`, `ZABBIX_URL` e `ZABBIX_TOKEN` do
  `.env.producao` são importados uma vez para a tela.
- Banco: script `db/14_configuracao.sql` (aplicado automaticamente pelo `sisti atualizar`).

## 1.3.0 (24/11/2026)

- **Novo menu PDVs:** cadastro de PDV por loja com número, IP, status (Ativo/Inativo) e os equipamentos do checkout
  (computador, impressora, scanner, teclado, gaveta e balança), escolhidos entre os equipamentos da loja.
  Um equipamento só pode estar em um PDV.
- **Parado automático:** se um equipamento vinculado é movimentado (manutenção, trânsito, aguardando orçamento,
  reserva...), o PDV aparece como **Parado**, com o motivo; volta a Ativo quando o equipamento retorna.
- **Sem comunicação:** o servidor testa o IP de cada PDV a cada minuto (ping, ou porta TCP configurável) e a tela
  destaca em vermelho o PDV que não responde, com o tempo sem resposta. Botão "Testar agora" no detalhe.
- **Zabbix (opcional):** com `ZABBIX_URL` e `ZABBIX_TOKEN`, mostra a disponibilidade do host e os alertas ativos
  de cada PDV (procurado pelo IP). Veja "Monitor de comunicação dos PDVs" em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).
- Painel de PDVs: resumo clicável (operando, parados, sem comunicação, inativos), cartões agrupados por loja com os
  periféricos em ícones coloridos, busca por número, IP, modelo ou série; atualiza sozinho a cada 30 segundos.
- Banco: script `db/13_pdv.sql` (aplicado automaticamente pelo `sisti atualizar`).

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
