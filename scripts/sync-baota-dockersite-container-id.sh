#!/bin/sh

set -eu

DB_PATH="/www/server/panel/data/db/docker.db"
SITE_NAME="chat.dyxcloud.com"
CONTAINER_NAME="nextchat"
IMAGE_NAME="${NEXTCHAT_IMAGE:-nextchat-baota:latest}"
GIT_BRANCH="${BUILD_GIT_BRANCH:-main}"
HEALTH_RETRY_COUNT="${NEXTCHAT_HEALTH_RETRY_COUNT:-60}"
HEALTH_RETRY_INTERVAL_SECONDS="${NEXTCHAT_HEALTH_RETRY_INTERVAL_SECONDS:-2}"
CONTAINER_ID=""
BACKUP_PATH="/root/docker.db.bak-nextchat-$(date '+%Y%m%d-%H%M%S')"

if [ ! -f "$DB_PATH" ]; then
  echo "[Deploy] 未找到宝塔 DockerSite 数据库: $DB_PATH" >&2
  exit 1
fi

wait_for_container_healthy() {
  i=1
  while [ "$i" -le "$HEALTH_RETRY_COUNT" ]; do
    status="$(
      docker inspect "$CONTAINER_NAME" \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'
    )"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      echo "[Deploy] 容器状态已就绪: $CONTAINER_NAME -> $status"
      return 0
    fi
    if [ "$i" -eq "$HEALTH_RETRY_COUNT" ]; then
      echo "[Deploy] 等待容器健康检查超时: $CONTAINER_NAME -> $status" >&2
      return 1
    fi
    sleep "$HEALTH_RETRY_INTERVAL_SECONDS"
    i=$((i + 1))
  done
}

record_deployment_version() {
  docker exec \
    -e BUILD_GIT_BRANCH="$GIT_BRANCH" \
    -e NEXTCHAT_IMAGE="$IMAGE_NAME" \
    "$CONTAINER_NAME" \
    node /app/scripts/record-deployment-version.mjs
}

wait_for_container_healthy
record_deployment_version
CONTAINER_ID="$(docker inspect "$CONTAINER_NAME" --format '{{.Id}}')"

cp -a "$DB_PATH" "$BACKUP_PATH"

python3 - "$DB_PATH" "$SITE_NAME" "$CONTAINER_ID" <<'PY'
import sqlite3
import sys

db_path, site_name, container_id = sys.argv[1:]
connection = sqlite3.connect(db_path)
try:
    rows = connection.execute(
        "select id, container_id from docker_sites where name = ?",
        (site_name,),
    ).fetchall()
    if len(rows) != 1:
        raise SystemExit(
            f"[Deploy] 期望唯一 DockerSite 记录，实际找到 {len(rows)} 条: {site_name}"
        )
    connection.execute(
        "update docker_sites set container_id = ? where name = ?",
        (container_id, site_name),
    )
    connection.commit()
finally:
    connection.close()

print(f"[Deploy] 宝塔 DockerSite 容器 ID 已同步: {site_name} -> {container_id}")
PY

echo "[Deploy] docker.db 备份: $BACKUP_PATH"

python3 - "$BACKUP_PATH" <<'PY'
from pathlib import Path
import sys

current_backup = Path(sys.argv[1]).resolve()
for backup in sorted(current_backup.parent.glob("docker.db.bak-nextchat-*")):
    if backup.resolve() == current_backup or not backup.is_file():
        continue
    backup.unlink()
    print(f"[Deploy] 已清理上一轮 docker.db 备份: {backup}")
PY
