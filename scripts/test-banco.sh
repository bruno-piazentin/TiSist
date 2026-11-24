#!/usr/bin/env bash
# Testa as regras críticas do banco (db/90_teste_regras.sql) num banco temporário, criado e apagado aqui.
# Não toca no banco de desenvolvimento nem no de produção.
#
# Uso: DATABASE_ADMIN_URL=postgres://postgres@localhost:5432/postgres npm run test:banco
#      (usuário com permissão de criar banco; o nome do banco na URL não importa)
set -euo pipefail
cd "$(dirname "$0")/../db"
export PGCLIENTENCODING=UTF8
ADMIN="${DATABASE_ADMIN_URL:?Defina DATABASE_ADMIN_URL (usuário que pode criar banco)}"
BASE="sisti_teste_regras_$$"
URL="${ADMIN%/*}/$BASE"          # mesma conexão, apontando para o banco temporário

psql "$ADMIN" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $BASE"
trap 'psql "$ADMIN" -qc "DROP DATABASE IF EXISTS $BASE" >/dev/null 2>&1 || true' EXIT

# O roteiro cria os próprios dados de teste: precisa só da estrutura e das regras
for f in 01_schema.sql 02_regras.sql; do
  psql "$URL" -v ON_ERROR_STOP=1 -1 -q -f "$f"
done

SAIDA="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f 90_teste_regras.sql 2>&1)" || { echo "$SAIDA"; echo "ERRO: o roteiro parou com erro"; exit 1; }
BLOQUEIOS="$(grep -c 'OK bloqueado' <<<"$SAIDA" || true)"
# Regra que deixou passar o que devia bloquear aparece como "FALHOU" (mesmo dentro de "OK bloqueado: FALHOU")
if grep -q 'FALHOU' <<<"$SAIDA"; then
  grep 'FALHOU' <<<"$SAIDA"
  echo "ERRO: regra do banco deixou passar uma operação que devia bloquear"
  exit 1
fi
echo "Regras do banco: $BLOQUEIOS bloqueio(s) conferido(s), nenhuma falha."
