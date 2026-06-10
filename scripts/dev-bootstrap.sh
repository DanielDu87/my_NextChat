#!/bin/sh

set -eu

cd /app

if [ ! -x ./node_modules/.bin/next ]; then
  echo "[Dev Bootstrap] node_modules 缺失，执行 yarn install"
  yarn install
else
  echo "[Dev Bootstrap] 复用现有 node_modules，跳过 yarn install"
fi

(
  echo "[Dev Bootstrap] 等待 Next.js 静态资源就绪后预热 API"

  until wget -q -O /dev/null http://127.0.0.1:3000/site.webmanifest; do
    sleep 2
  done

  echo "[Dev Bootstrap] 开始预热首页"
  wget -q -O /dev/null http://127.0.0.1:3000/ || true

  echo "[Dev Bootstrap] 开始预热数据库接口"
  wget -q -O /dev/null http://127.0.0.1:3000/api/db/health || true
  wget -q -O /dev/null http://127.0.0.1:3000/api/db/sync/chat-update || true
  echo "[Dev Bootstrap] 预热完成"
) &

exec ./node_modules/.bin/next dev -H 0.0.0.0
