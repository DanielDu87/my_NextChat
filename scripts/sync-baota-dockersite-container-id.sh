#!/bin/sh

set -eu

DB_PATH="/www/server/panel/data/db/docker.db"
SITE_NAME="chat.dyxcloud.com"
CONTAINER_NAME="nextchat"
CONTAINER_ID="$(docker inspect "$CONTAINER_NAME" --format '{{.Id}}')"
BACKUP_PATH="/root/docker.db.bak-nextchat-$(date '+%Y%m%d-%H%M%S')"

if [ ! -f "$DB_PATH" ]; then
  echo "[Deploy] 未找到宝塔 DockerSite 数据库: $DB_PATH" >&2
  exit 1
fi

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
