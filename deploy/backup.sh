#!/bin/sh
# Backup diário do banco SisTI (pg_dump formato custom) com retenção em dias.
# Faz um backup ao iniciar e depois todo dia em BACKUP_HORA. Arquivos em /backups/sisti-AAAAMMDD-HHMM.dump
set -u
HORA="${BACKUP_HORA:-02:00}"
DIAS="${BACKUP_DIAS:-30}"

backup() {
  arq="/backups/sisti-$(date +%Y%m%d-%H%M).dump"
  if pg_dump -Fc -f "$arq.tmp"; then
    mv "$arq.tmp" "$arq"
    echo "$(date '+%F %T') backup ok: $arq ($(du -h "$arq" | cut -f1))"
  else
    rm -f "$arq.tmp"
    echo "$(date '+%F %T') ERRO: backup falhou" >&2
  fi
  find /backups -name 'sisti-*.dump' -mtime +"$DIAS" -delete
}

until pg_isready -q; do sleep 5; done
backup
while true; do
  agora=$(date +%s)
  alvo=$(date -d "$(date +%Y-%m-%d) $HORA" +%s)
  [ "$alvo" -le "$agora" ] && alvo=$((alvo + 86400))
  sleep $((alvo - agora))
  backup
done
