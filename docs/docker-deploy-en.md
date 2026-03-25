# Docker Deployment Guide (AI Optimized)

This guide is written for two kinds of users:

- human operators
- AI / automation agents

To improve AI deployment success rate, this document follows these rules:

- fixed file names
- copy-paste ready commands
- explicit difference between first deploy, update, and restart
- explicit `docker compose profile`
- deployment-time download mirrors listed separately

## 1. Deployment Modes

This project supports two Docker deployment modes:

1. Official image
Best if you do not modify code and only want to run the app quickly.

2. Self-built image from this repository
Best if:
- you changed code
- you want China-friendly mirrors
- you want to use the built-in `docker-compose.yml`
- you need database / SSH tunnel integration

If deployment is performed by AI or automation, prefer the self-built mode.

## 2. Prerequisites

Recommended server resources:

- Run prebuilt image only: `2C4G`
- Build on the server: `4C8G` recommended

Required software:

```bash
docker --version
docker compose version
```

## 3. Important Files

AI agents should use these files first:

- Compose file: [docker-compose.yml](../docker-compose.yml)
- Docker image definition: [Dockerfile](../Dockerfile)
- Docker env template: [.env.docker.example](../.env.docker.example)

## 4. Recommended Compose Profile

The project defines three profiles in `docker-compose.yml`:

- `no-proxy`
Recommended for deployment and production runtime.

- `dev`
Development only. Do not use for production deployment.

Production rules:

- always use `--profile no-proxy`
- do not use `--profile dev` on production servers

## 5. First Deployment

### 5.1 Copy the environment file

```bash
cp .env.docker.example .env.docker
```

### 5.2 Edit `.env.docker`

Minimum required values:

```dotenv
OPENAI_API_KEY=sk-xxxx
CODE=your-access-password
```

Database deployment rule:

- this project now defaults to direct PostgreSQL connection
- do not enable `postgres-ssh-tunnel` by default
- future server deployments should keep using the database settings already stored in `.env.docker`
- enable `--profile ssh-tunnel` only when a jump host is explicitly required

Recommended database format:

```dotenv
PGHOST=your-fixed-database-host
PGPORT=5432
PGDATABASE=your-database-name
PGUSER=your-database-user
PGPASSWORD=your-database-password
```

Or use:

```dotenv
DATABASE_URL=postgres://user:password@host:5432/dbname
```

For servers in mainland China, also set:

```dotenv
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/
RT_CLIENT_TGZ_URL=https://your-cn-url/rt-client-0.5.0.tgz
```

Meaning:

- `ALPINE_MIRROR`
Alpine `apk` mirror. The Dockerfile already supports overriding this by build arg.

- `NPM_REGISTRY`
npm / yarn registry. Default is already `https://registry.npmmirror.com/`.

- `RT_CLIENT_TGZ_URL`
Download URL for the `rt-client` tgz. By default it uses the vendored local package in this repo. You can still replace it with your own OSS / COS / CDN / artifact repository URL.

### 5.3 Build and start

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

## 6. Verify Deployment

### 6.1 Check container status

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker ps
```

### 6.2 Check application logs

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker logs -f nextchat
```

### 6.3 Check database health endpoint

If database sync is enabled:

```bash
curl http://127.0.0.1:3000/api/db/health
```

Expected response should include:

- `ok: true`
- `configuredHost`
- `configuredPort`
- `database`
- `user`

### 6.4 Verify the app from inside the container

If `http://127.0.0.1:3000` looks broken on the host but the container is `Up`, verify the app from inside the container first:

```bash
docker exec chatgpt-next-web wget -S -O - http://127.0.0.1:3000
```

If this returns `HTTP/1.1 200 OK`, then:

- the NextChat app itself is already running correctly
- the issue is more likely on the host side, such as a local proxy, port forwarding, or another gateway layer

## 7. Ongoing Maintenance

### 7.1 Restart only

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy restart
```

### 7.2 Rebuild after code changes

```bash
git pull
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

### 7.3 Stop services

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy down
```

## 8. Official Image Quick Start

If you do not need a self-built image, run the official image directly:

```bash
docker pull yidadaa/chatgpt-next-web

docker run -d -p 3000:3000 \
  -e OPENAI_API_KEY=sk-xxxx \
  -e CODE=your-password \
  yidadaa/chatgpt-next-web
```

## 9. AI Execution Rules

If deployment is performed by AI, follow this order strictly:

1. Read [docker-compose.yml](../docker-compose.yml)
2. Copy [.env.docker.example](../.env.docker.example) to `.env.docker`
3. Fill required values in `.env.docker`
4. use `--profile no-proxy`
5. Run `./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build`
6. Run `./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d`
7. Run `./scripts/docker-compose-safe.sh --env-file .env.docker ps`
8. If database is enabled, check `curl http://127.0.0.1:3000/api/db/health`
9. If host-side access still looks wrong, run `docker exec chatgpt-next-web wget -S -O - http://127.0.0.1:3000`

Database rule:

- keep using the fixed database settings already present in `.env.docker`
- do not switch back to `postgres-ssh-tunnel` by default
- do not enable the `ssh-tunnel` profile unless explicitly required
- use [scripts/docker-compose-safe.sh](../scripts/docker-compose-safe.sh) by default
  do not call `docker compose build` directly
  because some environments fail on `~/.docker/buildx/activity` permission updates
- keep `HOSTNAME=0.0.0.0` for the production container
  otherwise Next.js standalone may fail with `getaddrinfo EAI_AGAIN` when resolving the container hostname
- the frontend version comes from `package.json`
  if the page config shows `vundefined`, check whether `package.json` is missing `version`

AI must not use the `dev` profile on production.

AI must not assume every restart requires rebuild.

Correct rule:

- first deployment: `build` required
- code update: `build` required
- restart only: `build` not required

## 10. Local Docker Development and Hot Reload

If the goal is local development rather than production deployment, use the `dev` profile:

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
```

Development mode behavior:

- source code is bind-mounted
- `next dev` is used
- most file changes trigger automatic hot reload
- container restart is not required for normal code edits
- image rebuild is not required for normal code edits

### Hot reload related variables

The following variables are already included in `.env.docker.example`:

```dotenv
WATCHPACK_POLLING=false
WATCHPACK_POLLING_INTERVAL=1000
CHOKIDAR_USEPOLLING=false
CHOKIDAR_INTERVAL=1000
```

Recommended rule:

- local Linux development / most server-side dev environments:
  keep them `false`
- Docker Desktop on macOS / Windows, if file changes are not detected reliably:
  switch them to `true`

Notes:

- polling is disabled by default to prefer native file events
- this usually gives faster hot reload and lower CPU usage
- enable polling only when file watching is unreliable

### AI rules for development mode

If the task is local development with hot reload, AI should:

1. use `--profile dev`
2. not use production profiles
3. not run `docker compose build` after every code change
4. not restart the container after every code change
5. rebuild only when:
   - `package.json` or `yarn.lock` changed
   - `Dockerfile` changed
   - the base dependency layer must be recreated
