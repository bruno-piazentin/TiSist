#!/usr/bin/env bash
# Comando "sisti": administração do SisTI instalado pelo instalar.sh
set -euo pipefail
DIR="${SISTI_DIR:-/opt/sisti}"
cd "$DIR" 2>/dev/null || { echo "SisTI não encontrado em $DIR"; exit 1; }
DC=(docker compose -f docker-compose.producao.yml --env-file .env.producao)

ultima_versao() { git tag -l "v*" --sort=-v:refname | head -1; }
versao_instalada() { git describe --tags --exact-match 2>/dev/null || git describe --tags --always 2>/dev/null || echo "?"; }
fazer_backup() {
  "${DC[@]}" exec -T backup sh -c "f=/backups/sisti-$(date +%Y%m%d-%H%M)-${1:-manual}.dump; pg_dump -Fc -f \"$f\" && echo \"backup: $f\""
}
migrar() { "${DC[@]}" exec -T db sh /sql/migrar.sh; }

case "${1:-ajuda}" in
  status)    "${DC[@]}" ps --format 'table {{.Service}}\t{{.Status}}' ;;
  logs)      "${DC[@]}" logs --tail "${3:-100}" -f "${2:-app}" ;;
  iniciar)   "${DC[@]}" up -d ;;
  parar)     "${DC[@]}" stop ;;
  reiniciar) "${DC[@]}" restart ;;
  versao)
    echo "Instalada:    $(versao_instalada)"
    if git fetch -q --tags origin 2>/dev/null; then
      u="$(ultima_versao)"; echo "Mais recente: ${u:-nenhuma publicada}"
      [[ -n "$u" && "$u" != "$(versao_instalada)" ]] && echo "Para instalar: sisti atualizar"
      echo; echo "Versões publicadas:"; git tag -l "v*" --sort=-v:refname | head -10 | sed "s/^/  /"
    else
      echo "(sem acesso ao GitHub para verificar versões novas)"
    fi ;;
  atualizar)
    git config core.fileMode false
    git fetch -q --tags origin || { echo "Não consegui acessar o GitHub."; exit 1; }
    alvo="${2:-$(ultima_versao)}"
    [[ -n "$alvo" ]] || { echo "Nenhuma versão publicada no GitHub."; exit 1; }
    git rev-parse -q --verify "refs/tags/$alvo^{commit}" >/dev/null || {
      echo "A versão $alvo não existe. Publicadas:"; git tag -l "v*" --sort=-v:refname | head -10 | sed "s/^/  /"; exit 1; }
    echo ">> de $(versao_instalada) para $alvo"
    echo ">> backup antes de atualizar"; fazer_backup "antes-$alvo"
    git -c advice.detachedHead=false checkout -q "$alvo" || {
      echo "Há arquivos alterados à mão em $DIR (veja: git -C $DIR status). Nada foi mudado."; exit 1; }
    "${DC[@]}" build -q app
    "${DC[@]}" up -d db && migrar
    "${DC[@]}" up -d
    install -m 755 deploy/sisti-cli.sh /usr/local/bin/sisti 2>/dev/null || true
    echo "SisTI $alvo instalado. Para voltar: sisti atualizar VERSAO_ANTERIOR (e, se o banco mudou, sisti restaurar o backup acima)" ;;
  migrar) migrar ;;
  sql)
    [[ -f "${2:-}" ]] || { echo "uso: sisti sql db/ARQUIVO.sql"; exit 1; }
    "${DC[@]}" exec -T db psql -U sisti_owner -d sisti -v ON_ERROR_STOP=1 -1 -f "/sql/$(basename "$2")" ;;
  backup) fazer_backup manual ;;
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
sisti versao              versão instalada e versões publicadas
sisti atualizar [vX.Y.Z]  instala a última versão (ou a indicada); faz backup antes
sisti migrar              aplica scripts de banco pendentes (o atualizar já faz)
sisti sql db/ARQ.sql      roda um script avulso no banco
sisti backup              faz um backup agora
sisti backups             lista os backups
sisti restaurar ARQUIVO   restaura um backup (substitui os dados atuais)
sisti certificado         exporta de novo o certificado (sisti-ca.crt)
EOF
  ;;
esac
