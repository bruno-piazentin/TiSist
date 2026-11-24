#!/usr/bin/env bash
# Cria (ou atualiza) o banco SisTI de desenvolvimento com os MESMOS scripts da produção (db/migracoes.txt).
# Uso: DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/sisti bash scripts/db-init.sh [--demo]
#   --demo  carrega também os dados fictícios de demonstração (NÃO usar em produção)
# Rodar de novo aplica só os scripts novos (o controle fica na tabela public.sisti_migracao).
set -euo pipefail
cd "$(dirname "$0")/.."
export PGCLIENTENCODING=UTF8
export DATABASE_ADMIN_URL="${DATABASE_ADMIN_URL:?Defina DATABASE_ADMIN_URL (usuário dono do banco, não o sisti_app)}"

if [[ "${1:-}" == "--demo" ]]; then
  # A demonstração entra logo após a estrutura (antes dos dados base de produção, que criariam os mesmos grupos)
  MIGRAR_ATE=06_fornecedor_detalhes.sql sh db/migrar.sh
  if [[ -n "$(psql "$DATABASE_ADMIN_URL" -qAtX -c "SELECT 1 FROM sisti.usuario WHERE login = 'gestor'")" ]]; then
    echo ">> dados de demonstração já carregados"
  else
    echo ">> 05_seed_demo.sql (dados de demonstração)"
    psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -1 -q -f db/05_seed_demo.sql >/dev/null
  fi
fi
sh db/migrar.sh
echo "Banco pronto. Se ainda não definiu, defina a senha do papel da aplicação (a mesma do DATABASE_URL no .env):"
echo "  psql \"\$DATABASE_ADMIN_URL\" -c \"ALTER ROLE sisti_app PASSWORD 'troque-esta-senha';\""
