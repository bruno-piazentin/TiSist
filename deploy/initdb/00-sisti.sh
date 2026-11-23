#!/bin/sh
# Executado pelo PostgreSQL só na PRIMEIRA inicialização (volume vazio).
# Cria a estrutura (sem dados de demonstração), a senha do papel da aplicação e o primeiro administrador.
set -eu
PSQL="psql -v ON_ERROR_STOP=1 -q --username $POSTGRES_USER --dbname $POSTGRES_DB"

for f in 01_schema.sql 02_regras.sql 04_app.sql 06_fornecedor_detalhes.sql 07_base_producao.sql 08_agenda.sql; do
  echo ">> SisTI: $f"
  $PSQL -1 -f "/sql/$f"
done

if [ -z "${ADMIN_SENHA:-}" ]; then
  echo "ERRO: defina ADMIN_SENHA no .env.producao (primeira inicialização)" >&2
  exit 1
fi

# Valores passados como variáveis do psql (:'x' faz o escape correto)
$PSQL -v app_senha="$DB_APP_PASSWORD" -v login="$ADMIN_LOGIN" -v email="$ADMIN_EMAIL" -v senha="$ADMIN_SENHA" <<'SQL'
ALTER ROLE sisti_app PASSWORD :'app_senha';
INSERT INTO sisti.usuario (nome, email, login, perfil_id, senha_hash)
SELECT 'Administrador', :'email', :'login', id, crypt(:'senha', gen_salt('bf', 10))
  FROM sisti.perfil WHERE codigo = 'ADMIN';
SQL
echo ">> SisTI: banco pronto, administrador '$ADMIN_LOGIN' criado"
