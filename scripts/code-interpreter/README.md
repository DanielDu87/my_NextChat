# Code Interpreter 独立部署说明

## 概述

自建 leezhuuuuu/Code-Interpreter-Api 替代失效的 `https://code.leez.tech` 公网服务，供 NextChat
`CodeInterpreter` 插件使用。架构：单进程 Flask + gunicorn + `subprocess.run` 直接跑 Python。

## 本地开发

### 目录结构

```
scripts/code-interpreter/
├── app.py                      # 上游入口（已含 AUTH_TOKEN 装饰器）
├── Dockerfile                  # NextChat 维护的构建文件
├── requirements.txt            # 上游 Flask/gunicorn/... 依赖
├── requirements.nextchat.txt   # NextChat 维护的扩展依赖（文档、表格、图表）
├── nextchat_runtime.py        # NextChat 包装（文件生成处理）
├── docker-compose.codeinterpreter.yml
└── .env.codeinterpreter.example
```

### 构建镜像

```bash
cd scripts/code-interpreter

# 构建镜像（镜像名固定为 codeinterpreter-api-local:latest）
docker build -t codeinterpreter-api-local:latest .

# 查看镜像
docker images | grep codeinterpreter
```

### 启动容器

```bash
# 启动容器，加入 nextchat_default 网络，不映射宿主机端口
docker run -d \
  --name codeinterpreter-local \
  --network nextchat_default \
  -e AUTH_TOKEN= \
  codeinterpreter-api-local:latest

# 确认运行
docker ps | grep codeinterpreter
```

### 停止和清理

```bash
# 停止容器
docker stop codeinterpreter-local

# 删除容器
docker rm codeinterpreter-local

# 删除镜像（需要重新构建）
docker rmi codeinterpreter-api-local:latest
```

### 热更新代码

修改 `nextchat_runtime.py` 或 `app.py` 后：

```bash
# 1. 重新构建镜像
docker build -t codeinterpreter-api-local:latest .

# 2. 停止旧容器
docker stop codeinterpreter-local

# 3. 删除旧容器
docker rm codeinterpreter-local

# 4. 启动新容器
docker run -d \
  --name codeinterpreter-local \
  --network nextchat_default \
  -e AUTH_TOKEN= \
  codeinterpreter-api-local:latest
```

一键脚本：

```bash
cd scripts/code-interpreter && \
docker stop codeinterpreter-local && \
docker rm codeinterpreter-local && \
docker rmi codeinterpreter-api-local:latest && \
docker build -t codeinterpreter-api-local:latest . && \
docker run -d \
  --name codeinterpreter-local \
  --network nextchat_default \
  -e AUTH_TOKEN= \
  codeinterpreter-api-local:latest && \
docker ps | grep codeinterpreter
```

### 测试

```bash
# 通过 NextChat 代理测试
curl -X POST "http://localhost:3000/api/proxy/runcode" \
  -H "Content-Type: application/json" \
  -H "X-Base-URL: http://codeinterpreter-local:5000" \
  -d '{"code":"print(1+1)","languageType":"python"}'

# 预期：{"output":"2\n"}
```

### 本地访问流程

1. 打开 `http://localhost:3000`
2. NextChat 检测到 localhost，自动将 CodeInterpreter 请求路由到 `http://codeinterpreter-local:5000`
3. 容器不映射端口，通过 Docker 内网通信

---

## 服务器部署

### 目录

远端服务器 `/www/dk_project/code_interpreter_api/`（独立于 `my_NextChat` 宝塔 Compose）。

### 首次部署

#### 1. 上传文件到服务器

```bash
scp -r scripts/code-interpreter/* root@42.193.15.117:/www/dk_project/code_interpreter_api/
```

需要上传的文件：
- `app.py`（上游入口）
- `requirements.txt`（上游依赖）
- `requirements.nextchat.txt`（NextChat 扩展依赖）
- `nextchat_runtime.py`（NextChat 包装）
- `Dockerfile`（NextChat 构建文件）
- `docker-compose.codeinterpreter.yml`（Compose 配置）
- `.env.codeinterpreter.example` → 复制为 `.env.codeinterpreter` 并填入 `AUTH_TOKEN`

#### 2. 配置环境变量

```bash
ssh root@42.193.15.117
cd /www/dk_project/code_interpreter_api

# 复制环境变量模板
cp .env.codeinterpreter.example .env.codeinterpreter

# 编辑 .env.codeinterpreter，填入 AUTH_TOKEN（Bearer Token）
vim .env.codeinterpreter
```

#### 3. 构建镜像

```bash
cd /www/dk_project/code_interpreter_api

# 构建镜像（镜像名：codeinterpreter-api-baota）
docker build -t codeinterpreter-api-baota:latest .
```

#### 4. 启动容器

```bash
# 使用 Compose 启动（会自动创建网络、卷、健康检查等）
docker compose -f docker-compose.codeinterpreter.yml up -d

# 确认容器健康
docker ps | grep codeinterpreter
# 预期：codeinterpreter  Up (healthy)
```

#### 5. 配置 Nginx 反代

在 `/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf` 添加：

```nginx
location /codeinterpreter/ {
    proxy_pass http://127.0.0.1:5000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    client_max_body_size 16m;
}
```

```bash
nginx -t && nginx -s reload
```

#### 6. NextChat 端配置

生产环境的 NextChat 插件 `CodeInterpreter` 已内置固定配置，schema 指向 `https://chat.dyxcloud.com/codeinterpreter`。
需要在插件页填写与服务器 `.env.codeinterpreter` 相同的 `AUTH_TOKEN`。

### 日常操作

#### 启动 / 停止

```bash
# 启动
docker compose -f docker-compose.codeinterpreter.yml up -d

# 停止
docker compose -f docker-compose.codeinterpreter.yml down

# 重启
docker compose -f docker-compose.codeinterpreter.yml restart
```

#### 查看日志

```bash
docker logs -f codeinterpreter
```

#### 修改 Token

```bash
# 1) 编辑 .env.codeinterpreter
vim /www/dk_project/code_interpreter_api/.env.codeinterpreter

# 2) 重启容器（--force-recreate 确保环境变量生效）
docker compose -f docker-compose.codeinterpreter.yml up -d --force-recreate

# 3) NextChat 插件页同步修改 authToken
```

### 升级

#### 升级镜像（修改 Dockerfile 或依赖后）

```bash
cd /www/dk_project/code_interpreter_api

# 重新构建镜像
docker build -t codeinterpreter-api-baota:latest .

# 重启容器
docker compose -f docker-compose.codeinterpreter.yml up -d --force-recreate
```

#### 升级上游

```bash
cd /www/dk_project/code_interpreter_api

# 下载最新上游 app.py 和 requirements.txt
curl -sL "https://raw.githubusercontent.com/leezhuuuuu/Code-Interpreter-Api/main/app.py" -o app.py
curl -sL "https://raw.githubusercontent.com/leezhuuuuu/Code-Interpreter-Api/main/requirements.txt" -o requirements.txt

# 重建镜像并重启
docker build -t codeinterpreter-api-baota:latest .
docker compose -f docker-compose.codeinterpreter.yml up -d --force-recreate
```

#### 升级 NextChat 包装代码

修改 `nextchat_runtime.py` 后：

```bash
cd /www/dk_project/code_interpreter_api

# 重建镜像并重启
docker build -t codeinterpreter-api-baota:latest .
docker compose -f docker-compose.codeinterpreter.yml up -d --force-recreate
```

### 回滚

```bash
# 停服务
cd /www/dk_project/code_interpreter_api
docker compose -f docker-compose.codeinterpreter.yml down

# 清镜像（不影响 nextchat）
docker rmi codeinterpreter-api-baota:latest

# 清持久化数据（谨慎，会丢失 data 目录内容）
docker volume rm code_interpreter_api_codeinterpreter-data

# 删目录
rm -rf /www/dk_project/code_interpreter_api
```

### 端到端验证

```bash
# 不带 token（预期 401）
curl -i -k -X POST https://chat.dyxcloud.com/codeinterpreter/runcode \
  -H "Content-Type: application/json" \
  -d '{"code":"print(1+1)","languageType":"python"}'

# 带 token（预期 200）
curl -i -k -X POST https://chat.dyxcloud.com/codeinterpreter/runcode \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"print(1+1)","languageType":"python"}'
# 预期：200 {"output":"2\n"}
```

---

## 鉴权说明

- `AUTH_TOKEN` 通过环境变量传入 `app.py`，由 `auth_required` 装饰器校验请求头 `Authorization: Bearer <token>`。
- `AUTH_TOKEN` 为空字符串时**不校验**（本地开发用）。
- 生产环境**必须**填入非空 Token。
- NextChat 端把同一个 token 填到插件的 `authToken` 字段。

---

## 文件生成功能

生成的 DOCX、XLSX、PDF、PPTX、CSV、文本和 ZIP 文件会从工作目录或 `/mnt/data`
收集并返回 NextChat。浏览器收到后写入 `/api/cache/upload`，模型必须使用返回的
`files[*].url` 生成下载链接，不能输出 `sandbox:/mnt/data/...`。

---

## 超时配置

- Python 执行超时：90 秒（`TIMEOUT` 环境变量）
- gunicorn worker 超时：120 秒

避免较慢的 Office/数据处理任务在 30 秒时被直接杀死并返回 HTML 502。

---

## 限制

- 单进程 gunicorn 默认 1 worker，并发受限于 Flask + Python 子进程。
- 不支持 bash（`app.py:run_code` 仅 python 分支）。
- 镜像安装的扩展库：`python-docx`、`openpyxl`、`pandas`、`matplotlib`、`Pillow`、`pypdf`。
- 上游固定使用 `PyYAML==5.4.1`，Dockerfile 将 pip、setuptools、wheel 和 Cython
  限制在兼容版本，并关闭构建隔离；不要直接升级到最新构建工具链。
- Python 包默认从阿里云 PyPI 镜像安装。
- 内存限制 512M；Python `import numpy/pandas` 类大包启动会变慢。
- `subprocess.run` 没有沙箱隔离；**别放敏感数据到 `/app/data`**。
