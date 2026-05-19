# Deploy — Asset Manager en `rcoloma.dev/evidencias`

Guía para tu servidor, que **ya tiene** instalado:

- Ubuntu LTS con `rodrigo` como usuario no-root + grupo `docker`
- Docker Engine + Docker Compose plugin
- Nginx en el host con Cloudflare delante (Origin Cert en `/etc/ssl/cloudflare/`)
- `ufw` activo permitiendo 22 / 80 / 443
- Backups y systemd ya operativos

Por eso esta guía sólo cubre lo que cambia: **levantar los contenedores
de esta app y enganchar su `location /evidencias` al Nginx existente**.

---

## 1. Clonar el repo y copiar el `.env`

```bash
cd ~
git clone git@github.com:<tu-usuario>/benchmarking.git
cd benchmarking
```

El repo ya incluye `deploy/.env` con tus claves (Anthropic, OpenAI,
secrets de sesión). **Está ignorado por git**, así que para llevarlo al
servidor lo copias por SCP desde tu máquina:

```bash
# Desde tu máquina, una vez:
scp deploy/.env rodrigo@rcoloma.dev:~/benchmarking/deploy/.env
ssh rodrigo@rcoloma.dev "chmod 600 ~/benchmarking/deploy/.env"
```

Antes de copiarlo edita una sola variable: `POSTGRES_PASSWORD`. Genera
una random:

```bash
openssl rand -base64 24      # → pégala en POSTGRES_PASSWORD del .env
```

Y replica ese mismo valor en el archivo de secret del contenedor Postgres:

```bash
ssh rodrigo@rcoloma.dev
mkdir -p ~/benchmarking/deploy/secrets
echo -n "EL_MISMO_POSTGRES_PASSWORD" > ~/benchmarking/deploy/secrets/postgres_password.txt
chmod 600 ~/benchmarking/deploy/secrets/postgres_password.txt
```

## 2. Enganchar el vhost al Nginx existente

Tu Nginx ya está corriendo, así que **no toques** ni los certificados ni
los demás vhosts. Tienes dos opciones:

**Opción A — añadir un site nuevo** (recomendado si `rcoloma.dev` aún no
sirve nada o lo que sirve no usa la raíz):

```bash
sudo cp deploy/nginx/rcoloma.dev.conf /etc/nginx/sites-available/benchmarking.conf
sudo ln -sf /etc/nginx/sites-available/benchmarking.conf \
            /etc/nginx/sites-enabled/benchmarking.conf
sudo nginx -t && sudo systemctl reload nginx
```

**Opción B — integrar en un vhost existente de `rcoloma.dev`** (si ya
tienes un `server { listen 443 ... server_name rcoloma.dev; }` activo):

Edita ese server block y añade solo los dos `location` de este proyecto:

```nginx
client_max_body_size 15M;     # si el bloque actual lo tiene más bajo

location /evidencias/ {
    proxy_pass http://127.0.0.1:8081/evidencias/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
}

location /evidencias/api/ {
    proxy_pass http://127.0.0.1:8080/evidencias/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";
    proxy_buffering off;            # SSE
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

Después `sudo nginx -t && sudo systemctl reload nginx`.

> Los contenedores `api` y `web` exponen sus puertos **sólo en
> `127.0.0.1`** (ver `docker-compose.prod.yml`), por lo que no son
> accesibles desde fuera del server: el único acceso público es a través
> de tu Nginx + Cloudflare.

## 3. Primer arranque

```bash
cd ~/benchmarking
./deploy/scripts/deploy.sh
```

Esto:
1. Construye las imágenes (`api`, `worker`, `web`) directamente en el server.
2. Ejecuta migraciones idempotentes (`node dist/migrate.mjs`).
3. Levanta los contenedores con `restart: unless-stopped`.
4. Verifica `https://rcoloma.dev/evidencias/api/healthz`.

Si todo va bien verás `✓ Deploy saludable` al final.

## 4. Deploys posteriores

Igual de simple:

```bash
ssh rodrigo@rcoloma.dev
cd ~/benchmarking
git pull --rebase --autostash
./deploy/scripts/deploy.sh
```

O automatizado con GitHub Actions (ver paso 5).

## 5. CI/CD desde GitHub Actions (opcional)

`.github/workflows/deploy.yml` ya está listo. Sólo necesitas configurar
tres secrets en tu repo de GitHub (Settings → Secrets → Actions):

- `DEPLOY_HOST` = `rcoloma.dev`
- `DEPLOY_USER` = `rodrigo`
- `DEPLOY_SSH_KEY` = clave privada SSH cuya pública esté en
  `~/.ssh/authorized_keys` del usuario `rodrigo`

A partir de ahí, cada push a `main` corre typecheck + tests y luego hace
SSH al server con `git pull && ./deploy/scripts/deploy.sh`.

## 6. Logs

```bash
# Logs en vivo de un servicio
docker compose -f deploy/docker-compose.yml logs -f api

# Acceso/error de Nginx
sudo tail -f /var/log/nginx/rcoloma.dev.access.log /var/log/nginx/rcoloma.dev.error.log

# DB shell (via túnel SSH)
ssh -L 5432:localhost:5432 rodrigo@rcoloma.dev
# en otra terminal:
psql postgres://assetmanager:***@localhost:5432/assetmanager
```

(Nota: el contenedor `postgres` NO expone puerto al host. Para conectarte
desde un cliente local, primero crea un túnel SSH como el de arriba y
luego apunta tu cliente a `localhost:5432`. Como las migraciones corren
dentro del contenedor `api`, normalmente no hace falta tocar la DB
directamente.)

## 7. Rollback rápido

```bash
cd ~/benchmarking
git log --oneline -10
git checkout <SHA_anterior>
./deploy/scripts/deploy.sh
```

Si el rollback toca un schema con cambios destructivos, restaura primero
del último backup nocturno con `./deploy/scripts/restore.sh <archivo.sql.gz>`.

## 8. Estructura de esta carpeta

```
deploy/
├── docker-compose.yml          # base (postgres, api, worker, web)
├── docker-compose.prod.yml     # overrides prod (port 127.0.0.1, restart)
├── .env                        # producción (copiado del .env del repo)
├── .env.example                # plantilla genérica de referencia
├── nginx/
│   └── rcoloma.dev.conf        # vhost listo para enganchar al Nginx del host
├── postgres/
│   └── init.sql                # CREATE EXTENSION pgcrypto
├── scripts/
│   ├── deploy.sh               # git pull + build + migrate + up
│   ├── backup.sh               # pg_dump + rotación
│   ├── restore.sh              # restore destructivo (pide YES)
│   └── healthcheck.sh          # smoke post-deploy
├── systemd/
│   ├── benchmarking-backup.service
│   └── benchmarking-backup.timer
└── secrets/
    └── postgres_password.txt   # NO commiteado — replica el POSTGRES_PASSWORD del .env
```

## 9. Backups (si aún no los tienes para este proyecto)

```bash
sudo cp deploy/systemd/benchmarking-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now benchmarking-backup.timer
systemctl list-timers benchmarking-backup.timer
```

Los dumps quedan en `/var/backups/postgres/assetmanager_<timestamp>.sql.gz`
con retención de 14 días.
