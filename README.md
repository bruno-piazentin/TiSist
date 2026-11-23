# SisTI – Controle de manutenção de equipamentos de TI

MVP do sistema especificado no documento “SisTI – Especificação do Sistema de Manutenção de TI”.
API em TypeScript (Node 22), PostgreSQL 16 com regras críticas no banco e PWA em React com operação offline.

## O que está pronto

| Área | Funcionalidades |
| --- | --- |
| Cadastros | Lojas, departamentos, grupos, marcas, fabricantes (vínculo marca × fabricante), modelos, fornecedores, serviços, categorias de falha, usuários, parâmetros |
| Equipamentos | Campos obrigatórios, série única por modelo, código interno automático, garantia sugerida pelo modelo, leitura por leitor USB ou câmera, exportação CSV |
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
db/            Scripts SQL (01 schema, 02 regras, 04 camada de aplicação, 05 dados de demonstração, 90 teste das regras)
server/        API: main.ts, http.ts (roteador), db.ts (transação + RLS), auth.ts (JWT e RBAC), modules/*
web/           PWA: index.html, sw.js, styles.css, src/ (React)
scripts/       build.mjs (esbuild) e db-init.sh
tests/         api.test.mjs (38 testes de ponta a ponta)
dist/          Build pronto (server.cjs + web/)
```

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
   `docker compose exec db sh -c 'for f in /sql/01_schema.sql /sql/02_regras.sql /sql/04_app.sql /sql/06_fornecedor_detalhes.sql; do psql -U sisti_owner -d sisti -1 -f $f; done'`
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

```bash
API_URL=http://localhost:3000 node tests/api.test.mjs   # banco com --demo
psql -d banco_vazio -f db/01_schema.sql -f db/02_regras.sql -f db/90_teste_regras.sql   # regras SQL isoladas
```

## Regras importantes para quem mantém o código

- Status, loja e localização do equipamento só mudam por `sisti.fn_movimentar` (o banco recusa `UPDATE` direto).
- `evento`, `movimentacao` e `custo_lancamento` são somente inclusão. Correção = estorno.
- Toda requisição autenticada abre uma transação com `sisti.usuario_id` definido: é isso que ativa o RLS e identifica o autor nos eventos.
- Parâmetros (janelas de reincidência, percentuais, cotações) ficam na tabela `sisti.parametro` e são editados na tela Parâmetros.

## Limitações conhecidas desta versão

- Login local com senha; SSO (AD/Entra ID) e MFA ficam para a próxima etapa.
- Anexos (fotos, laudos, PDF do orçamento) ainda não foram implementados: o modelo tem a tabela `anexo`, falta o armazenamento (S3/MinIO).
- Impressão de etiqueta com QR code não está pronta; a leitura funciona com o leitor de código de barras da loja (patrimônio/série) e pela câmera em navegadores com BarcodeDetector (Chrome no Android).
- Alertas aparecem no painel; envio por e-mail ainda não existe.
- Integração com ERP/NF-e: só exportação CSV e chave da NF-e informada manualmente.
- Os dados de demonstração são sintéticos e servem apenas para visualizar o painel.
