#!/usr/bin/env bash
# Comando "sisti": administração do SisTI instalado pelo instalar.sh
set -euo pipefail
DIR="${SISTI_DIR:-/opt/sisti}"
cd "$DIR" 2>/dev/null || { echo "SisTI não encontrado em $DIR"; exit 1; }
DC=(docker compose -f docker-compose.producao.yml --env-file .env.producao)

case "${1:-ajuda}" in
  status)    "${DC[@]}" ps --format 'table {{.Service}}\t{{.Status}}' ;;
  logs)      "${DC[@]}" logs --tail "${3:-100}" -f "${2:-app}" ;;
  iniciar)   "${DC[@]}" up -d ;;
  parar)     "${DC[@]}" stop ;;
  reiniciar) "${DC[@]}" restart ;;
  atualizar)
    git pull --ff-only
    "${DC[@]}" up -d --build
    echo "Atualizado. Se a versão trouxer arquivo novo em db/, aplique com: sisti sql db/ARQUIVO.sql" ;;
  sql)
    [[ -f "${2:-}" ]] || { echo "uso: sisti sql db/ARQUIVO.sql"; exit 1; }
    "${DC[@]}" exec -T db psql -U sisti_owner -d sisti -v ON_ERROR_STOP=1 -1 -f "/sql/$(basename "$2")" ;;
  backup)
    "${DC[@]}" exec -T backup sh -c 'f=/backups/sisti-$(date +%Y%m%d-%H%M)-manual.dump; pg_dump -Fc -f "$f" && echo "backup: $f"' ;;
  backups)
    "${DC[@]}" exec -T backup sh -c 'ls -lh /backups' ;;
  restaurar)
    [[ -n "${2:-}" ]] || { echo "uso: sisti restaurar sisti-AAAAMMDD-HHMM.dump   (veja: sisti backups)"; exit 1; }
    read -r -p "Isso substitui TODOS os dados atuais pelo backup $2. Digite RESTAURAR para confirmar: " c
    [[ "$c" == RESTAURAR ]] || { echo "cancelado"; exit 1; }
    "${DC[@]}" stop app
    "${DC[@]}" exec -T backup pg_restore --clean --if-exists --single-transaction -d sisti "/backups/$(basename "$2")"
    "${DC[@]}" start app
    echo "Restaurado." ;;
  certificado)
    "${DC[@]}" cp proxy:/data/caddy/pki/authorities/local/root.crt "$DIR/sisti-ca.crt" && echo "$DIR/sisti-ca.crt" ;;
  *)
    cat <<'EOF'
sisti status              situação dos serviços
sisti logs [serviço]      acompanha o log (app, db, proxy, backup)
sisti iniciar | parar | reiniciar
sisti atualizar           baixa a versão nova do GitHub e reinicia
sisti sql db/ARQ.sql      aplica um script de atualização do banco
sisti backup              faz um backup agora
sisti backups             lista os backups
sisti restaurar ARQUIVO   restaura um backup (substitui os dados atuais)
sisti certificado         exporta de novo o certificado (sisti-ca.crt)
EOF
  ;;
esac
