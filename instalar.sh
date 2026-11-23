#!/usr/bin/env bash
# =====================================================================
# Instalador do SisTI para servidor Linux (Ubuntu/Debian).
#
#   curl -fsSL https://raw.githubusercontent.com/bruno-piazentin/TiSist/main/instalar.sh | sudo bash
#   ou, dentro da pasta do projeto:  sudo bash instalar.sh
#
# Faz: instala Docker e Git, baixa o SisTI em /opt/sisti, gera senhas, sobe banco + sistema +
# HTTPS + backup, exporta o certificado e instala o comando "sisti".
# Rodar de novo atualiza o sistema e mantém senhas e dados.
#
# Sem perguntas (automação): defina SISTI_DOMINIO, ADMIN_EMAIL e, opcionalmente,
# ADMIN_SENHA, BACKUP_PASTA, SISTI_DIR, SISTI_REPO e SISTI_SEM_PERGUNTAS=1.
# =====================================================================
set -euo pipefail

REPO="${SISTI_REPO:-https://github.com/bruno-piazentin/TiSist.git}"
DIR="${SISTI_DIR:-/opt/sisti}"
ENVF=".env.producao"

azul() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m    ✓ %s\033[0m\n' "$*"; }
erro() { printf '\033[31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }
senha() { openssl rand -hex "${1:-24}"; }
pergunta() {  # pergunta "texto" "padrão" -> resposta (lê do terminal mesmo via curl | bash)
  local r=""
  if [[ "${SISTI_SEM_PERGUNTAS:-0}" == 1 || ! -r /dev/tty ]]; then echo "$2"; return; fi
  read -r -p "    $1 [$2]: " r < /dev/tty || true
  echo "${r:-$2}"
}

# ---------------------------------------------------------------------
azul "Verificando o servidor"
[[ $EUID -eq 0 ]] || erro "rode como root: sudo bash instalar.sh"
command -v apt-get >/dev/null || erro "este instalador é para Ubuntu/Debian"
ok "$(. /etc/os-release && echo "$PRETTY_NAME")"

azul "Instalando dependências"
if ! command -v git >/dev/null || ! command -v openssl >/dev/null || ! command -v curl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq git openssl curl ca-certificates >/dev/null
fi
ok "git, openssl e curl"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || erro "Docker Compose não encontrado"
ok "$(docker --version)"

azul "Baixando o SisTI em $DIR"
ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -d "$DIR/.git" ]]; then
  ok "código já presente"
elif [[ -n "$ORIGEM" && -f "$ORIGEM/docker-compose.producao.yml" && "$ORIGEM" != "$DIR" ]]; then
  mkdir -p "$DIR" && cp -a "$ORIGEM/." "$DIR/" && ok "copiado de $ORIGEM"
elif [[ ! -f "$DIR/docker-compose.producao.yml" ]]; then
  git clone -q "$REPO" "$DIR" || erro "não consegui baixar $REPO (repositório privado? clone manualmente em $DIR)"
  ok "baixado de $REPO"
fi
cd "$DIR"
# Instala a última versão publicada (tag vX.Y.Z) ou a indicada em SISTI_VERSAO; sem tags, o código mais recente
if [[ -d .git ]]; then
  git config core.fileMode false
  git fetch -q --tags origin 2>/dev/null || true
  ALVO="${SISTI_VERSAO:-$(git tag -l "v*" --sort=-v:refname | head -1)}"
  if [[ -n "$ALVO" ]]; then
    git -c advice.detachedHead=false checkout -q "$ALVO" || erro "não consegui mudar para $ALVO (arquivos alterados à mão? veja: git -C $DIR status)"
    ok "versão $ALVO"
  else
    git pull --ff-only -q 2>/dev/null || true; ok "código mais recente (nenhuma versão publicada)"
  fi
fi
chmod +x deploy/*.sh deploy/initdb/*.sh db/*.sh 2>/dev/null || true

# ---------------------------------------------------------------------
PRIMEIRA=0
if [[ -f "$ENVF" ]]; then
  azul "Configuração existente encontrada: mantendo senhas e dados"
else
  PRIMEIRA=1
  azul "Configuração (Enter aceita o valor sugerido)"
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  DOMINIO="${SISTI_DOMINIO:-$(pergunta "Nome de acesso (registro no DNS interno)" "sisti.empresa.local")}"
  [[ -n "$IP" && "$DOMINIO" != *"$IP"* ]] && DOMINIO="$DOMINIO, $IP"   # também acessível pelo IP
  EMAIL="${ADMIN_EMAIL:-$(pergunta "E-mail do administrador" "ti@empresa.com.br")}"
  ADMIN_SENHA="${ADMIN_SENHA:-$(senha 6)}"
  BACKUP="${BACKUP_PASTA:-$(pergunta "Pasta dos backups (de preferência um NAS montado)" "$DIR/backups")}"
  mkdir -p "$BACKUP"
  umask 077
  cat > "$ENVF" <<EOF
# Gerado pelo instalador em $(date '+%F %T'). Guarde uma cópia em cofre de senhas.
SISTI_DOMINIO=$DOMINIO
SISTI_TLS=internal
DB_OWNER_PASSWORD=$(senha)
DB_APP_PASSWORD=$(senha)
JWT_SECRET=$(senha 32)
JWT_HORAS=12
ADMIN_LOGIN=admin
ADMIN_EMAIL=$EMAIL
ADMIN_SENHA=$ADMIN_SENHA
BACKUP_HORA=02:00
BACKUP_DIAS=30
BACKUP_PASTA=$BACKUP
TZ=America/Sao_Paulo
EOF
  umask 022
  ok "senhas geradas em $DIR/$ENVF"
fi

# IP do servidor: sem ele o HTTPS pelo IP falha (o navegador não envia nome/SNI).
# Também corrige instalações feitas antes desta opção existir.
IP_SRV="${SISTI_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
if [[ -n "$IP_SRV" ]]; then
  if ! grep -q '^SISTI_IP=.' "$ENVF"; then
    sed -i '/^SISTI_IP=/d' "$ENVF"; echo "SISTI_IP=$IP_SRV" >> "$ENVF"
  fi
  DOMS="$(grep '^SISTI_DOMINIO=' "$ENVF" | cut -d= -f2-)"
  [[ "$DOMS" == *"$IP_SRV"* ]] || sed -i "s/^SISTI_DOMINIO=.*/&, $IP_SRV/" "$ENVF"
  ok "acesso também pelo IP: https://$(grep '^SISTI_IP=' "$ENVF" | cut -d= -f2-)"
fi

# ---------------------------------------------------------------------
DC=(docker compose -f docker-compose.producao.yml --env-file "$ENVF")
azul "Montando e iniciando (a primeira vez leva alguns minutos)"
LOG=/var/log/sisti-instalacao.log
if ! "${DC[@]}" up -d --build --quiet-pull >"$LOG" 2>&1; then
  tail -15 "$LOG"; erro "falha ao montar/iniciar (log completo: $LOG)"
fi
ok "serviços iniciados"

DOM1="$(grep ^SISTI_DOMINIO "$ENVF" | cut -d= -f2 | cut -d, -f1 | xargs)"
printf "    aguardando o sistema responder"
for _ in $(seq 1 60); do
  if curl -skf -o /dev/null --resolve "$DOM1:443:127.0.0.1" "https://$DOM1/api/saude"; then ok "sistema respondendo"; break; fi
  printf '.'; sleep 3
done
echo
"${DC[@]}" ps --format '    {{.Service}}: {{.Status}}'

azul "Banco de dados"
"${DC[@]}" exec -T db sh /sql/migrar.sh | sed "s/^/    /" || erro "falha ao atualizar o banco (veja: sisti logs db)"

# Senha inicial ainda no arquivo = instalação nova (ou interrompida antes do fim): confere o banco,
# mostra a senha no resumo e apaga do servidor
MOSTRAR_SENHA=0
if grep -q '^ADMIN_SENHA=' "$ENVF"; then
  ADMIN_SENHA="$(grep '^ADMIN_SENHA=' "$ENVF" | cut -d= -f2-)"
  LOGDB="$("${DC[@]}" logs db 2>&1 || true)"   # sem pipe direto no grep -q (pipefail + SIGPIPE)
  [[ "$LOGDB" == *"administrador 'admin' criado"* ]] || erro "o banco não foi inicializado; veja: sisti logs db"
  sed -i '/^ADMIN_SENHA=/d' "$ENVF"   # a senha inicial não fica guardada no servidor
  MOSTRAR_SENHA=1
fi

azul "Certificado HTTPS"
for _ in $(seq 1 10); do
  "${DC[@]}" cp proxy:/data/caddy/pki/authorities/local/root.crt "$DIR/sisti-ca.crt" >/dev/null 2>&1 && break; sleep 2
done
[[ -f "$DIR/sisti-ca.crt" ]] && ok "$DIR/sisti-ca.crt (instale nos computadores e celulares)"

azul "Comando de administração"
install -m 755 deploy/sisti-cli.sh /usr/local/bin/sisti
ok "use: sisti ajuda"

# ---------------------------------------------------------------------
echo
echo "====================================================================="
echo "  SisTI instalado:  https://$DOM1"
if [[ $MOSTRAR_SENHA == 1 ]]; then
  echo
  echo "  Usuário: admin"
  echo "  Senha:   $ADMIN_SENHA"
  echo "  (anote agora: ela não fica salva. Troque no primeiro acesso.)"
fi
echo
echo "  Próximos passos:"
echo "   1. Crie no DNS interno o registro $DOM1 -> $(hostname -I 2>/dev/null | awk '{print $1}')"
echo "   2. Instale $DIR/sisti-ca.crt como CA raiz confiável (GPO / celulares)"
echo "   3. Guarde uma cópia de $DIR/$ENVF em local seguro"
echo "   4. Confira se a pasta de backup está em outro disco ou NAS"
echo "  Guia completo: $DIR/docs/IMPLANTACAO.md"
echo "====================================================================="
