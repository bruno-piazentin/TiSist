# Implantação do SisTI em servidor interno

Passo a passo para colocar o SisTI em produção num servidor da empresa. A instalação usa Docker e sobe quatro serviços:

| Serviço | Função |
| --- | --- |
| `db` | PostgreSQL 16. Não fica exposto na rede |
| `app` | Aplicação SisTI |
| `proxy` | Caddy: HTTPS nas portas 443/80 |
| `backup` | Cópia diária do banco, com retenção |

## Instalação rápida (recomendada)

Num servidor Ubuntu/Debian limpo (requisitos no passo 1), rode:
```bash
curl -fsSL https://raw.githubusercontent.com/bruno-piazentin/TiSist/main/instalar.sh | sudo bash
```
Esse comando só funciona com o repositório público. Se ele for privado, faça assim:
```bash
git clone https://github.com/bruno-piazentin/TiSist.git && cd TiSist
sudo bash instalar.sh
```

O instalador faz três perguntas: nome de acesso, e-mail do administrador e pasta dos backups. Depois, sozinho:
- instala Docker e Git;
- gera todas as senhas;
- sobe o banco, o sistema, o HTTPS e o backup;
- exporta o certificado para `/opt/sisti/sisti-ca.crt`;
- mostra a **senha inicial do admin** (anote: ela não fica salva).

Ele também instala o comando `sisti`:

| Comando | Para quê |
| --- | --- |
| `sisti status` | Situação dos serviços |
| `sisti logs app` | Log da aplicação |
| `sisti versao` | Versão instalada e versões publicadas |
| `sisti atualizar` | Instala a última versão publicada (faz backup antes) |
| `sisti backup` / `sisti backups` | Faz um backup agora / lista os backups |
| `sisti restaurar ARQUIVO` | Restaura um backup (pede confirmação) |
| `sisti certificado` | Exporta de novo o certificado |

Rodar o instalador de novo é seguro: ele atualiza o sistema e mantém senhas e dados.

Depois da instalação, siga os passos **2** (DNS), **5** (certificado nos dispositivos), **6** (carga dos dados) e **7** (backup em outro disco). As seções abaixo detalham a instalação manual e cada etapa.

## 1. Servidor

- **Recomendado:** VM Linux (Ubuntu Server 24.04 LTS) com 2 vCPU, 4 GB de RAM e 40 GB de disco.
- Windows Server também roda Docker, mas exige mais ajustes. Prefira Linux.
- IP fixo na rede interna.
- Liberar as portas **443** e **80** (TCP) no firewall para a rede das lojas. As lojas precisam alcançar o servidor por VPN ou MPLS.

Instalar Docker e Git:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # saia e entre de novo na sessão
sudo apt install -y git
```

## 2. Nome de acesso (DNS)

No DNS interno (geralmente o servidor AD), crie um registro **A**, por exemplo `sisti.empresa.local`, apontando para o IP do servidor. Todos vão acessar por `https://sisti.empresa.local`.

## 3. Baixar e configurar

```bash
git clone https://github.com/bruno-piazentin/TiSist.git sisti
cd sisti
cp deploy/producao.env.exemplo .env.producao
nano .env.producao
```

Preencha o arquivo. Gere cada senha com `openssl rand -hex 24` e o `JWT_SECRET` com `openssl rand -hex 32`.

| Variável | O que é |
| --- | --- |
| `SISTI_DOMINIO` | Nome criado no DNS. Pode incluir o IP: `sisti.empresa.local, 192.168.0.20` |
| `DB_OWNER_PASSWORD` / `DB_APP_PASSWORD` | Senhas do banco. Use só letras e números |
| `JWT_SECRET` | Segredo das sessões |
| `ADMIN_EMAIL` / `ADMIN_SENHA` | Primeiro administrador, criado na primeira subida |
| `BACKUP_PASTA` | Onde gravar os backups (ver passo 7) |

Guarde uma cópia do `.env.producao` em local seguro, como um cofre de senhas. Sem as senhas, os backups continuam restauráveis, mas a reinstalação fica mais trabalhosa.

## 4. Subir

```bash
docker compose -f docker-compose.producao.yml --env-file .env.producao up -d --build
docker compose -f docker-compose.producao.yml --env-file .env.producao ps
```

Na primeira subida, o banco é criado:
- sem dados de demonstração;
- com grupos de produto, categorias de falha e tipos de serviço básicos;
- com o administrador definido no `.env.producao`.

Confira nos logs:
```bash
docker compose -f docker-compose.producao.yml --env-file .env.producao logs db | grep SisTI
```

Depois disso:
1. **Apague a linha `ADMIN_SENHA`** do `.env.producao`.
2. Entre no sistema e troque a senha pelo próprio sistema.

> Dica: para não repetir os parâmetros, crie um atalho:
> `alias sisti='docker compose -f docker-compose.producao.yml --env-file .env.producao'`
> e use `sisti ps`, `sisti logs app`, `sisti up -d --build` etc.

## 5. Certificado HTTPS

O HTTPS é obrigatório: sem ele, o modo offline, a fila de sincronização e a câmera não funcionam. Há duas opções.

### Opção A: certificado gerado pelo próprio Caddy (`SISTI_TLS=internal`, padrão)

O Caddy cria uma autoridade certificadora (CA) própria. Exporte o certificado raiz:
```bash
docker compose -f docker-compose.producao.yml --env-file .env.producao cp proxy:/data/caddy/pki/authorities/local/root.crt ./sisti-ca.crt
```
Instale `sisti-ca.crt` como **Autoridade de Certificação Raiz Confiável** nos dispositivos:
- **Computadores do domínio:** distribua por GPO (Configuração do Computador → Políticas → Configurações do Windows → Configurações de Segurança → Políticas de Chave Pública → Autoridades de Certificação Raiz Confiáveis).
- **Celulares e tablets Android:** Configurações → Segurança → Criptografia e credenciais → Instalar certificado → Certificado de CA.

### Opção B: certificado da empresa

Use esta opção se a empresa já tem uma CA interna (AD CS) ou um certificado curinga.
1. Coloque `sisti.crt` (com a cadeia) e `sisti.key` em `deploy/certs/`.
2. No `.env.producao`, defina `SISTI_TLS=/certs/sisti.crt /certs/sisti.key`.
3. Rode `up -d` de novo.

## 6. Primeiro acesso e carga dos dados

Entre em `https://sisti.empresa.local` como administrador e cadastre, nesta ordem:
1. **Lojas** e o CD
2. **Departamentos**
3. **Usuários**: perfil e lojas de cada um
4. **Marcas**, **fabricantes** e **modelos** (os grupos já vêm prontos)
5. **Fornecedores**
6. **Equipamentos** (inventário)

O administrador cuida da configuração. O dia a dia (chamados, movimentações) é feito pelos perfis Gestor, Coordenador e Técnico.

## 7. Backup

O serviço `backup` faz uma cópia ao iniciar e outra todo dia em `BACKUP_HORA`. Os arquivos ficam em `BACKUP_PASTA`, no formato `sisti-AAAAMMDD-HHMM.dump`, e as cópias com mais de `BACKUP_DIAS` dias são apagadas.

**Importante:** um backup no mesmo disco do servidor não protege contra perda do servidor.
- Aponte `BACKUP_PASTA` para um compartilhamento de rede ou NAS montado no servidor, por exemplo `/mnt/nas/sisti`.
- Ou copie a pasta diariamente para outro local.

Para conferir:
```bash
ls -lh backups/
docker compose -f docker-compose.producao.yml --env-file .env.producao logs backup | tail
```

### Restaurar um backup

```bash
D="docker compose -f docker-compose.producao.yml --env-file .env.producao"
$D stop app
$D exec -T backup pg_restore --clean --if-exists --single-transaction -d sisti /backups/sisti-AAAAMMDD-HHMM.dump
$D start app
```

Em um servidor novo, o procedimento é o mesmo:
1. Faça os passos 1 a 4 usando o mesmo `.env.producao`.
2. Copie o arquivo `.dump` para a pasta de backups.
3. Rode os comandos acima.

**Teste a restauração uma vez por trimestre**, num servidor de homologação.

## 8. Versões e atualização

Cada entrega do SisTI recebe um número de versão (ex.: `v1.2.0`), publicado como *Release* no GitHub com a lista do que mudou. O histórico completo fica em [CHANGELOG.md](../CHANGELOG.md). A versão instalada aparece no menu do usuário, no canto superior direito.

| Comando | O que faz |
| --- | --- |
| `sisti versao` | Mostra a versão instalada e as publicadas |
| `sisti atualizar` | Instala a última versão publicada |
| `sisti atualizar v1.1.0` | Instala uma versão específica (também serve para voltar) |

O `sisti atualizar`:
1. faz um backup do banco (`sisti-AAAAMMDD-HHMM-antes-vX.Y.Z.dump`);
2. baixa a versão e monta o sistema novo;
3. aplica os scripts de banco novos (lista em `db/migracoes.txt`; cada um roda uma vez só);
4. reinicia o sistema.

Os usuários recebem a nova versão ao recarregar a página.

**Voltar para a versão anterior:** `sisti atualizar vX.Y.Z` com a versão anterior. Se a versão nova mudou o banco, restaure também o backup feito antes da atualização (`sisti backups` para ver o nome, `sisti restaurar ARQUIVO`). O que foi lançado no sistema depois da atualização se perde na restauração.

### Publicar uma versão (desenvolvimento)

1. Teste as mudanças localmente.
2. Atualize o número em `package.json` e escreva as notas em `CHANGELOG.md`.
3. Mudanças no banco: crie `db/NN_descricao.sql` (idempotente) e acrescente o nome no **fim** de `db/migracoes.txt`. Nunca altere um script já publicado.
4. Commit, tag e envio:
   ```bash
   git commit -am "Versão 1.2.0"
   git tag -a v1.2.0 -m "Versão 1.2.0"
   git push origin main --tags
   ```
5. Crie a *Release* no GitHub a partir da tag, com as notas do CHANGELOG.

## 9. Problemas comuns

| Sintoma | Verificar |
| --- | --- |
| Navegador avisa "conexão não é segura" | CA não instalada no dispositivo (passo 5) ou nome acessado diferente de `SISTI_DOMINIO` |
| Página não abre | `ps` (todos "Up"?), firewall nas portas 443/80, registro DNS |
| Abre pelo nome, mas não pelo IP (erro de conexão) | `SISTI_IP` no `.env.producao` com o IP do servidor, e o IP também em `SISTI_DOMINIO`. Rodar `sudo bash instalar.sh` de novo preenche os dois |
| Erro ao entrar | `logs app` e `logs db` |
| Backup não aparece | `logs backup` e permissão de escrita em `BACKUP_PASTA` |
