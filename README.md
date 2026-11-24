# SisTI – Controle de manutenção de equipamentos de TI

MVP do sistema especificado no documento “SisTI – Especificação do Sistema de Manutenção de TI”.
API em TypeScript (Node 22), PostgreSQL 16 com regras críticas no banco e PWA em React com operação offline.

## O que está pronto

| Área | Funcionalidades |
| --- | --- |
| Cadastros | Lojas, departamentos, grupos, marcas, fabricantes (vínculo marca × fabricante), modelos, fornecedores, serviços, categorias de falha, usuários, parâmetros |
| Equipamentos | Campos obrigatórios, série única por modelo, código interno automático, garantia sugerida pelo modelo, leitura por leitor USB ou câmera, exportação CSV |
| PDVs | Cadastro por loja com computador, impressora, scanner, teclado, gaveta e balança vinculados; situação Parado automática quando um periférico é movimentado; indicação de PDV sem comunicação (ping do servidor e, opcionalmente, Zabbix) |
| Ciclo de vida | 9 status, matriz de transições no banco, status anterior/atual em cada movimentação, localização física separada da loja vinculada, transferência entre lojas |
| Chamados | Abertura com garantia e reincidência, prioridade crítica automática (loja crítica sem reserva), diagnóstico, encerramento com categoria confirmada, cancelamento |
| Orçamentos | Itens por tipo, versões, quadro comparativo, cotações mínimas, aprovação por alçada com segregação de funções, dados de “reparar ou trocar” |
| Custos | Lançamento real com NF-e, estorno, aviso de desvio orçado × realizado, fechamento mensal, exportação CSV para o ERP |
| Baixa | Solicitação e aprovação por gestor diferente do solicitante; descarte com certificado |
| Painel | KPIs (MTTR, reincidência, SLA, custo médio), ranking de lojas (absoluto, por m² e por checkout), tendência com média móvel, reincidência por modelo (taxa sobre a base instalada), mapa de calor, projeção, sazonalidade, alertas |
| Offline | Casca do app em cache, cópia local dos dados, fila de abertura de chamado e movimentações com UUID (sem duplicidade), conflitos registrados no servidor |
| Segurança | JWT, senhas bcrypt (pgcrypto), RBAC por perfil, Row Level Security por loja, histórico somente de inclusão, papel de banco sem DELETE |

## Estrutura

```
server/          API (Node + TypeScript)
  main.ts          ponto de entrada: registra as rotas de cada módulo
  http.ts          roteador, leitura do corpo, tratamento de erros, arquivos estáticos
  db.ts            conexão e transação por requisição (define o usuário para o RLS)
  auth.ts          token de sessão (JWT) e matriz de permissões por perfil
  validacao.ts     peças de validação reutilizáveis (uuid, opcional, dia, hora)
  evento.ts        registrarEvento(): grava na linha do tempo / auditoria
  monitor-pdv.ts   teste periódico de comunicação dos PDVs (ping/TCP) e consulta ao Zabbix
  modules/         um arquivo por assunto: equipamentos, chamados, orcamentos, custos, agenda...
web/             PWA (React): index.html, sw.js (offline), styles.css
  src/main.tsx     login, layout (menu, barra do topo) e rotas das telas
  src/ui.tsx       componentes base (Tabela, Campo, Modal, Opcoes) e formatação
  src/api.ts       chamadas à API e fila offline;  src/pages/  uma tela (ou grupo de telas) por arquivo
db/              banco PostgreSQL
  migracoes.txt    lista, em ordem, dos scripts que montam o banco (produção e desenvolvimento)
  migrar.sh        aplica os scripts da lista que ainda não rodaram (controle em public.sisti_migracao)
  NN_*.sql         os scripts; 05_seed_demo.sql = dados fictícios; 90_teste_regras.sql = teste das regras
scripts/         build.mjs (esbuild), db-init.sh (banco de desenvolvimento), test-banco.sh
tests/           api.test.mjs (testes de ponta a ponta da API)
deploy/          produção: Caddy (HTTPS), backup, comando "sisti", criação do banco no Docker
docs/            IMPLANTACAO.md (servidor), MELHORIAS-PENDENTES.md (dívida técnica)
CHANGELOG.md     o que mudou em cada versão
```

> **Produção em servidor interno:** siga [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) (Docker com HTTPS e backup diário).

## Como executar (servidor Linux ou Windows com Node 22)

1. **Banco de dados** (PostgreSQL 16+):
   ```bash
   createdb sisti
   DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/sisti bash scripts/db-init.sh        # produção
   DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/sisti bash scripts/db-init.sh --demo # com dados fictícios
   psql postgres://postgres@localhost:5432/sisti -c "ALTER ROLE sisti_app PASSWORD 'uma-senha-forte';"
   ```
   Sem `--demo`, crie o primeiro administrador:
   ```sql
   INSERT INTO sisti.usuario (nome, email, login, perfil_id, senha_hash)
   SELECT 'Administrador', 'ti@suaempresa.com.br', 'admin', id, crypt('troque-ja', gen_salt('bf', 10))
     FROM sisti.perfil WHERE codigo = 'ADMIN';
   ```
2. **Aplicação**:
   ```bash
   cp .env.example .env     # ajuste DATABASE_URL e JWT_SECRET (openssl rand -hex 32)
   npm install
   npm run build
   npm start                # http://localhost:3010 (porta definida em PORT no .env)
   ```
3. **Docker** (alternativa): `docker compose up -d --build` (abre em http://localhost:3010; troque em `SISTI_PORTA` no .env), depois rode os scripts de `db/` no container do banco:
   `docker compose exec db sh /sql/migrar.sh` (a mesma lista de scripts da produção)
   e defina a senha do `sisti_app` igual a `DB_APP_PASSWORD`.

**HTTPS é obrigatório em produção**: o service worker, a câmera e a fila offline só funcionam em `https://` (ou `localhost`). Use um proxy reverso (Nginx, Caddy ou IIS) com certificado.

### Usuários de demonstração (senha `sisti123`)

| Login | Perfil | Observação |
| --- | --- | --- |
| admin | Administrador | Usuários e parâmetros; não aprova valores |
| gestor | Gestor de TI | Alçada R$ 1.000 |
| coordenador | Coordenador | Alçada R$ 5.000 |
| diretoria | Diretoria | Sem limite |
| tecnico | Técnico | Lojas L01 a L04 e CD |
| gerente | Gerente de loja | Só a L01 |
| compras | Compras/Financeiro | Lança custos e fecha competências |
| auditoria | Auditoria | Somente leitura |

## Testes

| Comando | O que testa | Precisa de |
| --- | --- | --- |
| `npm run typecheck` | tipos do TypeScript (servidor e telas) | nada |
| `npm test` | 38 testes de ponta a ponta da API (login, permissões, restrição por loja, fluxo de chamado, orçamento, custos, baixa, sincronização offline, painel) | servidor rodando com banco `--demo`; informe a porta: `API_URL=http://localhost:3010 npm test` |
| `npm run test:banco` | regras críticas do banco (transições, segregação de funções, histórico só de inclusão) num banco temporário, criado e apagado pelo próprio teste | `DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/postgres` |

Rode os três antes de publicar uma versão.

## Para quem vai programar

1. **Rodar local:** siga "Como executar" acima com `npm run db:demo` (banco com dados fictícios) e `npm run dev`.
2. **Mudança no banco:** crie `db/NN_descricao.sql` (que possa rodar duas vezes sem erro) e acrescente o nome no **fim**
   de `db/migracoes.txt`. Nunca altere um script já publicado: crie outro. `npm run db:init` aplica no seu banco;
   em produção, o `sisti atualizar` aplica sozinho.
3. **Nova rota na API:** no módulo do assunto em `server/modules/`, use `exigir(usuario, 'permissao')`, valide a entrada
   com zod (peças prontas em `server/validacao.ts`), rode o SQL dentro de `tx(u.id, ...)` (ativa a restrição por loja)
   e registre ações importantes com `registrarEvento()` (`server/evento.ts`).
4. **Nova tela:** em `web/src/pages/`, usando os componentes de `web/src/ui.tsx` (`Tabela`, `Campo`, `Modal`, `Opcoes`):
   eles já cuidam de teclado, rótulos e leitor de tela. Registre a rota em `rota()` no `web/src/main.tsx`.
5. **Publicar versão:** número em `package.json`, notas no `CHANGELOG.md`, testes, tag `vX.Y.Z`
   (passo a passo em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md), "Publicar uma versão").

Melhorias de código já mapeadas e ainda não feitas: [docs/MELHORIAS-PENDENTES.md](docs/MELHORIAS-PENDENTES.md).

## Regras importantes para quem mantém o código

- Status, loja e localização do equipamento só mudam por `sisti.fn_movimentar` (o banco recusa `UPDATE` direto).
- `evento`, `movimentacao` e `custo_lancamento` são somente inclusão. Correção = estorno.
- Toda requisição autenticada abre uma transação com `sisti.usuario_id` definido: é isso que ativa o RLS e identifica o autor nos eventos.
- Parâmetros (janelas de reincidência, percentuais, cotações) ficam na tabela `sisti.parametro` e são editados na tela Parâmetros.
- Configurações de integração (Zabbix, monitor de PDVs) ficam na tabela `sisti.configuracao` (segredos cifrados em `configuracao_segredo`), lidas com `lerConfiguracoes()` de `server/modules/configuracao.ts`. Endereço de API ou servidor novo: acrescente a chave nessa tabela (script em `db/`), em `VALIDAR` e, se for de um grupo novo, em `GRUPOS_PARAMETRO` (servidor e tela). Não crie variável de ambiente para isso.
- A alteração de parâmetros é permitida por grupo (`usuario.parametro_grupos`; o administrador altera todos).

## Limitações conhecidas desta versão

- Login local com senha; SSO (AD/Entra ID) e MFA ficam para a próxima etapa.
- Anexos (fotos, laudos, PDF do orçamento) ainda não foram implementados: o modelo tem a tabela `anexo`, falta o armazenamento (S3/MinIO).
- Impressão de etiqueta com QR code não está pronta; a leitura funciona com o leitor de código de barras da loja (patrimônio/série) e pela câmera em navegadores com BarcodeDetector (Chrome no Android).
- Alertas aparecem no painel; envio por e-mail ainda não existe.
- Integração com ERP/NF-e: só exportação CSV e chave da NF-e informada manualmente.
- Os dados de demonstração são sintéticos e servem apenas para visualizar o painel.
