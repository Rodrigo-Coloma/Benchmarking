# Deploy — Asset Manager en Ubuntu LTS + Cloudflare

Guía completa para levantar la app en un servidor Ubuntu (22.04 / 24.04 LTS)
detrás de Cloudflare, sirviendo en `https://rcoloma.dev/evidencias` (V3 §4).

> Esta carpeta es **declarativa**: no se ejecuta `docker compose` desde tu
> máquina. Se sincroniza con `git pull` en el servidor y se aplica con
> `./deploy/scripts/deploy.sh`.

---

## 1. Provisión del servidor (sólo la primera vez)

Como `root` en un servidor recién creado:

```bash
# Usuario sin privilegios + grupo docker
adduser rodrigo
usermod -aG sudo,docker rodrigo

# SSH key only — desactiva login con password
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: sólo 22, 80, 443
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# fail2ban + unattended upgrades
apt-get update
apt-get install -y fail2ban
dpkg-reconfigure --priority=low unattended-upgrades

# Docker + Nginx
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
apt-get install -y nginx
systemctl enable --now nginx
```

Para hardening avanzado: restringir 80/443 a IPs de Cloudflare
(<https://www.cloudflare.com/ips/>) con `ufw allow from <ip> to any port 443` y
revocar la regla genérica.

## 2. Cloudflare

1. **DNS** → A `rcoloma.dev` → `<IP_servidor>`, **Proxy ON** (naranja).
2. **SSL/TLS** → modo **Full (strict)**.
3. **SSL/TLS → Origin Server** → *Create Certificate* → RSA 2048, 15 años.
   Descarga `.pem` y `.key` y guárdalos en el server:
   ```bash
   sudo mkdir -p /etc/ssl/cloudflare
   sudo install -m 600 -o root -g root rcoloma.dev.pem /etc/ssl/cloudflare/
   sudo install -m 600 -o root -g root rcoloma.dev.key /etc/ssl/cloudflare/
   ```
4. *(Opcional)* **Authenticated Origin Pulls** → habilita y descomenta el
   bloque `ssl_client_certificate` en `nginx/rcoloma.dev.conf`.
5. **Security → Bots → Bot Fight Mode** ON.

## 3. Clonar el repo y configurar secrets

Como `rodrigo`:

```bash
cd ~
git clone git@github.com:<tu-usuario>/asset-manager.git
cd asset-manager

# .env del compose (api + worker)
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env
# - genera SESSION_SECRET y ARGON2_SECRET: openssl rand -base64 48
# - pega tu API key de Anthropic
# - pon un POSTGRES_PASSWORD distinto del placeholder
chmod 600 deploy/.env

# Secret del contenedor Postgres
mkdir -p deploy/secrets
echo -n "el_mismo_password_que_pusiste_en_.env" > deploy/secrets/postgres_password.txt
chmod 600 deploy/secrets/postgres_password.txt
```

## 4. Nginx vhost

```bash
sudo cp deploy/nginx/rcoloma.dev.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/rcoloma.dev.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Primer deploy

```bash
./deploy/scripts/deploy.sh
```

Esto:
1. Construye las imágenes (`api`, `worker`, `web`) directamente en el server.
2. Ejecuta las migraciones idempotentes (`dist/migrate.mjs`).
3. Levanta los contenedores con `restart: unless-stopped`.
4. Ejecuta el smoke healthcheck contra `https://rcoloma.dev/evidencias`.

## 6. Backups

Copia las unidades systemd a `/etc/systemd/system/` y activa el timer:

```bash
sudo cp deploy/systemd/asset-manager-backup.service /etc/systemd/system/
sudo cp deploy/systemd/asset-manager-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now asset-manager-backup.timer

# Verifica
systemctl list-timers asset-manager-backup.timer
```

Los dumps quedan en `/var/backups/postgres/assetmanager_<timestamp>.sql.gz`
con retención de 14 días. Para restaurar uno:

```bash
./deploy/scripts/restore.sh /var/backups/postgres/assetmanager_20260519T033000Z.sql.gz
```

## 7. CI/CD desde GitHub Actions

`.github/workflows/deploy.yml` corre en cada push a `main`:

1. Job `typecheck` — `pnpm install` + `pnpm typecheck` + tests.
2. Job `deploy` — SSH al server, `git pull` + `deploy.sh`.

Necesitas configurar tres secrets en el repo:
- `DEPLOY_HOST` = `rcoloma.dev`
- `DEPLOY_USER` = `rodrigo`
- `DEPLOY_SSH_KEY` = clave privada (la pública vive en
  `/home/rodrigo/.ssh/authorized_keys`)

Para mayor restricción, en `authorized_keys` puedes encadenar el comando:
```
command="cd /home/rodrigo/asset-manager && ./deploy/scripts/deploy.sh",no-agent-forwarding,no-port-forwarding ssh-ed25519 AAAA…
```

## 8. Logs y observabilidad

```bash
# logs en vivo de un servicio
docker compose -f deploy/docker-compose.yml logs -f api

# acceso/error Nginx
sudo tail -f /var/log/nginx/rcoloma.dev.{access,error}.log

# DB shell (vía túnel)
ssh -L 5432:localhost:5432 rodrigo@rcoloma.dev
# en otra terminal:
psql postgres://assetmanager:***@localhost:5432/assetmanager
```

`pg-boss` archiva jobs terminados a los 7 días y los borra a los 30
(configurado en `src/jobs/index.ts`).

## 9. Rollback rápido

```bash
cd ~/asset-manager
git log --oneline -10
git checkout <SHA_anterior>
./deploy/scripts/deploy.sh
```

Si el rollback toca migraciones de schema, restaura primero del último
backup nocturno con `restore.sh`.

## 10. Estructura de esta carpeta

```
deploy/
├── docker-compose.yml          # base (postgres, api, worker, web)
├── docker-compose.prod.yml     # overrides prod (port 127.0.0.1, restart)
├── .env.example                # plantilla del .env (NO se commitea el real)
├── nginx/
│   └── rcoloma.dev.conf        # vhost del host (TLS + reverse proxy)
├── postgres/
│   └── init.sql                # extensions iniciales
├── scripts/
│   ├── deploy.sh               # git pull + build + migrate + up
│   ├── backup.sh               # pg_dump + rotación
│   ├── restore.sh              # restore destructivo (pide YES)
│   └── healthcheck.sh          # smoke post-deploy
├── systemd/
│   ├── asset-manager-backup.service
│   └── asset-manager-backup.timer
└── secrets/
    └── postgres_password.txt   # NO commiteado
```
