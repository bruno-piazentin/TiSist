#!/usr/bin/env bash
# Cria a estrutura do banco SisTI.
# Uso: DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/sisti bash scripts/db-init.sh [--demo]
#   --demo  carrega dados fictícios de demonstração (NÃO usar em produção)
set -euo pipefail
cd "$(dirname "$0")/../db"
URL="${DATABASE_ADMIN_URL:?Defina DATABASE_ADMIN_URL (usuário dono do banco, não o sisti_app)}"
for f in 01_schema.sql 02_regras.sql 04_app.sql 06_fornecedor_detalhes.sql 08_agenda.sql; do
  echo ">> $f"
  psql "$URL" -v ON_ERROR_STOP=1 -1 -q -f "$f"
done
if [[ "${1:-}" == "--demo" ]]; then
  echo ">> 05_seed_demo.sql (dados de demonstração)"
  psql "$URL" -v ON_ERROR_STOP=1 -1 -q -f 05_seed_demo.sql
fi
echo "Banco pronto. Defina a senha do papel da aplicação:"
echo "  psql \"$URL\" -c \"ALTER ROLE sisti_app PASSWORD 'troque-esta-senha';\""
