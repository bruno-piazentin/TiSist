#!/bin/sh
# Aplica os scripts de db/migracoes.txt que ainda não rodaram neste banco.
# Produção: roda dentro do contêiner do banco, na criação (initdb) e a cada "sisti atualizar".
# Desenvolvimento: scripts/db-init.sh chama com DATABASE_ADMIN_URL definida.
set -eu
DIR="$(dirname "$0")"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"   # sem avisos informativos (ex.: "política não existe")
# Conexão: DATABASE_ADMIN_URL (desenvolvimento) ou as variáveis do contêiner (produção)
PSQL() {
  if [ -n "${DATABASE_ADMIN_URL:-}" ]; then psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -qAtX "$@"
  else psql -v ON_ERROR_STOP=1 -qAtX --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"; fi
}

# Scripts que já faziam parte dos bancos instalados antes deste controle existir (até a versão 1.1.0)
BASE="01_schema.sql 02_regras.sql 04_app.sql 06_fornecedor_detalhes.sql 07_base_producao.sql 08_agenda.sql 09_carga_unidades.sql"

if [ "$(PSQL -c "SELECT to_regclass('public.sisti_migracao') IS NOT NULL")" != t ]; then
  ja_instalado="$(PSQL -c "SELECT to_regclass('sisti.usuario') IS NOT NULL")"
  PSQL -c "CREATE TABLE public.sisti_migracao (arquivo text PRIMARY KEY, aplicado_em timestamptz NOT NULL DEFAULT now(), base boolean NOT NULL DEFAULT false)"
  if [ "$ja_instalado" = t ]; then
    for f in $BASE; do PSQL -c "INSERT INTO public.sisti_migracao (arquivo, base) VALUES ('$f', true)"; done
    echo ">> banco existente: scripts da base marcados como aplicados"
  fi
fi

aplicados=0
for f in $(grep -v '^[[:space:]]*#' "$DIR/migracoes.txt" | tr -d '\r'); do
  if [ -n "$(PSQL -c "SELECT 1 FROM public.sisti_migracao WHERE arquivo = '$f'")" ]; then
    [ "$f" = "${MIGRAR_ATE:-}" ] && break
    continue
  fi
  echo ">> aplicando $f"
  PSQL -1 -f "$DIR/$f" -c "INSERT INTO public.sisti_migracao (arquivo) VALUES ('$f')" >/dev/null
  aplicados=$((aplicados + 1))
  [ "$f" = "${MIGRAR_ATE:-}" ] && break   # opcional: para depois deste script (usado pelo db-init --demo)
done
echo ">> banco atualizado ($aplicados script(s) novo(s))"
