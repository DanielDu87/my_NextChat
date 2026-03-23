<div align="center">

<a href='#企业版'>
  <img src="./docs/images/ent.svg" alt="icon"/>
</a>

<h1 align="center">NextChat</h1>

一键免费部署你的私人 ChatGPT 网页应用，支持 Claude, GPT4 & Gemini Pro 模型。

[NextChatAI](https://nextchat.club?utm_source=readme) / [企业版](#%E4%BC%81%E4%B8%9A%E7%89%88) / [演示 Demo](https://chat-gpt-next-web.vercel.app/) / [反馈 Issues](https://github.com/Yidadaa/ChatGPT-Next-Web/issues) / [加入 Discord](https://discord.gg/zrhvHCr79N)

[<img src="https://vercel.com/button" alt="Deploy on Zeabur" height="30">](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FChatGPTNextWeb%2FChatGPT-Next-Web&env=OPENAI_API_KEY&env=CODE&project-name=nextchat&repository-name=NextChat) [<img src="https://zeabur.com/button.svg" alt="Deploy on Zeabur" height="30">](https://zeabur.com/templates/ZBUEFA) [<img src="https://gitpod.io/button/open-in-gitpod.svg" alt="Open in Gitpod" height="30">](https://gitpod.io/#https://github.com/Yidadaa/ChatGPT-Next-Web)

</div>

## Sponsor AI API

<a href='https://302.ai/'>
  <img src="https://github.com/user-attachments/assets/d8c0c513-1e18-4d3b-a2a9-ff3696aec0d4" width="100%" alt="icon"/>
</a>

[302.AI](https://302.ai/) 是一个按需付费的AI应用平台，提供市面上最全的AI API和AI在线应用。

## 企业版

满足您公司私有化部署和定制需求

- **品牌定制**：企业量身定制 VI/UI，与企业品牌形象无缝契合
- **资源集成**：由企业管理人员统一配置和管理数十种 AI 资源，团队成员开箱即用
- **权限管理**：成员权限、资源权限、知识库权限层级分明，企业级 Admin Panel 统一控制
- **知识接入**：企业内部知识库与 AI 能力相结合，比通用 AI 更贴近企业自身业务需求
- **安全审计**：自动拦截敏感提问，支持追溯全部历史对话记录，让 AI 也能遵循企业信息安全规范
- **私有部署**：企业级私有部署，支持各类主流私有云部署，确保数据安全和隐私保护
- **持续更新**：提供多模态、智能体等前沿能力持续更新升级服务，常用常新、持续先进

企业版咨询: **business@nextchat.dev**

<img width="300" src="https://github.com/user-attachments/assets/bb29a11d-ff75-48a8-b1f8-d2d7238cf987">

## 开始使用

1. 准备好你的 [OpenAI API Key](https://platform.openai.com/account/api-keys);
2. 点击右侧按钮开始部署：
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FYidadaa%2FChatGPT-Next-Web&env=OPENAI_API_KEY&env=CODE&env=GOOGLE_API_KEY&project-name=chatgpt-next-web&repository-name=ChatGPT-Next-Web)，直接使用 Github 账号登录即可，记得在环境变量页填入 API Key 和[页面访问密码](#配置页面访问密码) CODE；
3. 部署完毕后，即可开始使用；
4. （可选）[绑定自定义域名](https://vercel.com/docs/concepts/projects/domains/add-a-domain)：Vercel 分配的域名 DNS 在某些区域被污染了，绑定自定义域名即可直连。

<div align="center">
   
![主界面](./docs/images/cover.png)

</div>

## 保持更新

如果你按照上述步骤一键部署了自己的项目，可能会发现总是提示“存在更新”的问题，这是由于 Vercel 会默认为你创建一个新项目而不是 fork 本项目，这会导致无法正确地检测更新。
推荐你按照下列步骤重新部署：

- 删除掉原先的仓库；
- 使用页面右上角的 fork 按钮，fork 本项目；
- 在 Vercel 重新选择并部署，[请查看详细教程](./docs/vercel-cn.md#如何新建项目)。

### 打开自动更新

> 如果你遇到了 Upstream Sync 执行错误，请[手动 Sync Fork 一次](./README_CN.md#手动更新代码)！

当你 fork 项目之后，由于 Github 的限制，需要手动去你 fork 后的项目的 Actions 页面启用 Workflows，并启用 Upstream Sync Action，启用之后即可开启每小时定时自动更新：

![自动更新](./docs/images/enable-actions.jpg)

![启用自动更新](./docs/images/enable-actions-sync.jpg)

### 手动更新代码

如果你想让手动立即更新，可以查看 [Github 的文档](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork) 了解如何让 fork 的项目与上游代码同步。

你可以 star/watch 本项目或者 follow 作者来及时获得新功能更新通知。

## 配置页面访问密码

> 配置密码后，用户需要在设置页手动填写访问码才可以正常聊天，否则会通过消息提示未授权状态。

> **警告**：请务必将密码的位数设置得足够长，最好 7 位以上，否则[会被爆破](https://github.com/Yidadaa/ChatGPT-Next-Web/issues/518)。

本项目提供有限的权限控制功能，请在 Vercel 项目控制面板的环境变量页增加名为 `CODE` 的环境变量，值为用英文逗号分隔的自定义密码：

```
code1,code2,code3
```

增加或修改该环境变量后，请**重新部署**项目使改动生效。

## 环境变量

> 本项目大多数配置项都通过环境变量来设置，教程：[如何修改 Vercel 环境变量](./docs/vercel-cn.md)。

### `OPENAI_API_KEY` （必填项）

OpenAI 密钥，你在 openai 账户页面申请的 api key，使用英文逗号隔开多个 key，这样可以随机轮询这些 key。

### `CODE` （可选）

访问密码，可选，可以使用逗号隔开多个密码。

**警告**：如果不填写此项，则任何人都可以直接使用你部署后的网站，可能会导致你的 token 被急速消耗完毕，建议填写此选项。

### `BASE_URL` （可选）

> Default: `https://api.openai.com`

> Examples: `http://your-openai-proxy.com`

OpenAI 接口代理 URL，如果你手动配置了 openai 接口代理，请填写此选项。

> 如果遇到 ssl 证书问题，请将 `BASE_URL` 的协议设置为 http。

### `OPENAI_ORG_ID` （可选）

指定 OpenAI 中的组织 ID。

### `AZURE_URL` （可选）

> 形如：https://{azure-resource-url}/openai

Azure 部署地址。

### `AZURE_API_KEY` （可选）

Azure 密钥。

### `AZURE_API_VERSION` （可选）

Azure Api 版本，你可以在这里找到：[Azure 文档](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference#chat-completions)。

### `GOOGLE_API_KEY` (可选)

Google Gemini Pro 密钥.

### `GOOGLE_URL` (可选)

Google Gemini Pro Api Url.

### `ANTHROPIC_API_KEY` (可选)

anthropic claude Api Key.

### `ANTHROPIC_API_VERSION` (可选)

anthropic claude Api version.

### `ANTHROPIC_URL` (可选)

anthropic claude Api Url.

### `BAIDU_API_KEY` (可选)

Baidu Api Key.

### `BAIDU_SECRET_KEY` (可选)

Baidu Secret Key.

### `BAIDU_URL` (可选)

Baidu Api Url.

### `BYTEDANCE_API_KEY` (可选)

ByteDance Api Key.

### `BYTEDANCE_URL` (可选)

ByteDance Api Url.

### `ALIBABA_API_KEY` (可选)

阿里云（千问）Api Key.

### `ALIBABA_URL` (可选)

阿里云（千问）Api Url.

### `IFLYTEK_URL` (可选)

讯飞星火Api Url.

### `IFLYTEK_API_KEY` (可选)

讯飞星火Api Key.

### `IFLYTEK_API_SECRET` (可选)

讯飞星火Api Secret.

### `CHATGLM_API_KEY` (可选)

ChatGLM Api Key.

### `CHATGLM_URL` (可选)

ChatGLM Api Url.

### `DEEPSEEK_API_KEY` (可选)

DeepSeek Api Key.

### `DEEPSEEK_URL` (可选)

DeepSeek Api Url.

### `HIDE_USER_API_KEY` （可选）

如果你不想让用户自行填入 API Key，将此环境变量设置为 1 即可。

### `DISABLE_GPT4` （可选）

如果你不想让用户使用 GPT-4，将此环境变量设置为 1 即可。

#### Custom 余额查询代码配置

当前仓库里的 `Custom` 供应商余额查询不再通过页面单独配置，而是统一在代码里维护。

- 配置文件：`app/config/custom-balance.ts`
- 匹配方式：按 API 配置页中每个 `Custom` 条目的“名称”精确匹配 `profileName`
- 也支持通过 `aliases` 做名称包含匹配，适合像 `AihubMix-主账号` 这类命名
- 新增一个 `Custom` 配置后，如果要支持余额查询，需要同步在 `CUSTOM_BALANCE_QUERY_RULES` 里新增一条规则

可用配置项：

- `profileName`: API 配置页中的配置名称，必须一致
- `mode`: 余额查询方式，目前支持 `json`、`aihubmix`、`ocoolai`、`toapis`、`openai-compatible`
- `url`: 余额查询请求地址或平台基础地址
- `apiKey`: 余额查询专用 API Key
- `field`: 仅 `json` 模式需要，表示余额字段路径，例如 `data.balance`
- `aliases`: 可选，名称别名列表，命中任一别名即视为匹配

示例：

```ts
export const CUSTOM_BALANCE_QUERY_RULES = [
  {
    profileName: "My Proxy",
    mode: "json",
    url: "https://your-proxy.example.com/api/user/balance",
    apiKey: "balance-query-api-key",
    field: "data.balance",
  },
  {
    profileName: "OpenAI Proxy",
    mode: "openai-compatible",
    url: "https://your-openai-proxy.example.com",
    apiKey: "balance-query-api-key",
  },
];
```

说明：

- 当前仓库已内置 `AihubMix`、`YutoAPI`、`Ocoolai`、`ToAPIs` 余额查询规则
- `json` 模式会直接请求 `url`，再按 `field` 读取余额值
- `aihubmix` / `ocoolai` 模式会请求 `${url}/api/user/self`
- `toapis` 模式会请求 `${url}/v1/user/balance`
- `openai-compatible` 模式会请求 `${url}/v1/dashboard/billing/usage` 和 `${url}/v1/dashboard/billing/subscription`

#### 余额查询请求明细

当前代码中的余额查询全部使用 `GET` 方法：

| mode | 方法 | 请求 URL |
| --- | --- | --- |
| `json` | `GET` | `url` 原样请求 |
| `aihubmix` | `GET` | `${url}/api/user/self` |
| `ocoolai` | `GET` | `${url}/api/user/self` |
| `toapis` | `GET` | `${url}/v1/user/balance` |
| `openai-compatible` | `GET` | `${url}/v1/dashboard/billing/usage?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` |
| `openai-compatible` | `GET` | `${url}/v1/dashboard/billing/subscription` |

当前仓库内置规则如下：

| 配置名称 | mode | 基础 URL | 余额查询专用 Key |
| --- | --- | --- | --- |
| `AihubMix` | `aihubmix` | `https://aihubmix.com` | `9c560d99d6ef4c69a2b34adbad50f870` |
| `YutoAPI` | `openai-compatible` | `https://cn.gptapi.asia` | `sk-korED7kHNSVz1KYY3c3b9aE599Bc41A29674C419B71d217a` |
| `Ocoolai` | `ocoolai` | `https://one.ooo.cool` | `73eb755abbfa475f8b0063c533f2e0c5` |
| `ToAPIs` | `toapis` | `https://toapis.com` | `sk-Pn3Pqt9iCIRYBPMilukEJ6wKx3F6TKNAquIOP1ockZgZrSBx` |

### `DISABLE_FAST_LINK` （可选）

如果你想禁用从链接解析预制设置，将此环境变量设置为 1 即可。

### `WHITE_WEBDAV_ENDPOINTS` (可选)

如果你想增加允许访问的webdav服务地址，可以使用该选项，格式要求：

- 每一个地址必须是一个完整的 endpoint
  > `https://xxxx/xxx`
- 多个地址以`,`相连

### `CUSTOM_MODELS` （可选）

> 示例：`+qwen-7b-chat,+glm-6b,-gpt-3.5-turbo,gpt-4-1106-preview=gpt-4-turbo` 表示增加 `qwen-7b-chat` 和 `glm-6b` 到模型列表，而从列表中删除 `gpt-3.5-turbo`，并将 `gpt-4-1106-preview` 模型名字展示为 `gpt-4-turbo`。
> 如果你想先禁用所有模型，再启用指定模型，可以使用 `-all,+gpt-3.5-turbo`，则表示仅启用 `gpt-3.5-turbo`

用来控制模型列表，使用 `+` 增加一个模型，使用 `-` 来隐藏一个模型，使用 `模型名=展示名` 来自定义模型的展示名，用英文逗号隔开。

在Azure的模式下，支持使用`modelName@Azure=deploymentName`的方式配置模型名称和部署名称(deploy-name)

> 示例：`+gpt-3.5-turbo@Azure=gpt35`这个配置会在模型列表显示一个`gpt35(Azure)`的选项。
> 如果你只能使用Azure模式，那么设置 `-all,+gpt-3.5-turbo@Azure=gpt35` 则可以让对话的默认使用 `gpt35(Azure)`

在ByteDance的模式下，支持使用`modelName@bytedance=deploymentName`的方式配置模型名称和部署名称(deploy-name)

> 示例: `+Doubao-lite-4k@bytedance=ep-xxxxx-xxx`这个配置会在模型列表显示一个`Doubao-lite-4k(ByteDance)`的选项

### `DEFAULT_MODEL` （可选）

更改默认模型

### `VISION_MODELS` (可选)

> 默认值：空
> 示例：`gpt-4-vision,claude-3-opus,my-custom-model` 表示为这些模型添加视觉能力，作为对默认模式匹配的补充（默认会检测包含"vision"、"claude-3"、"gemini-1.5"等关键词的模型）。

在默认模式匹配之外，添加更多具有视觉能力的模型。多个模型用逗号分隔。

### `DEFAULT_INPUT_TEMPLATE` （可选）

自定义默认的 template，用于初始化『设置』中的『用户输入预处理』配置项

### `STABILITY_API_KEY` (optional)

Stability API密钥

### `STABILITY_URL` (optional)

自定义的Stability API请求地址

### `ENABLE_MCP` (optional)

启用MCP（Model Context Protocol）功能

### `SILICONFLOW_API_KEY` (optional)

SiliconFlow API Key.

### `SILICONFLOW_URL` (optional)

SiliconFlow API URL.

### `AI302_API_KEY` (optional)

302.AI API Key.

### `AI302_URL` (optional)

302.AI API URL.

## 开发

点击下方按钮，开始二次开发：

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/Yidadaa/ChatGPT-Next-Web)

在开始写代码之前，需要在项目根目录新建一个 `.env.local` 文件，里面填入环境变量：

```
OPENAI_API_KEY=<your api key here>

# 中国大陆用户，可以使用本项目自带的代理进行开发，你也可以自由选择其他代理地址
BASE_URL=https://b.nextweb.fun/api/proxy
```

### 本地开发

1. 安装 nodejs 18 和 yarn，具体细节请询问 ChatGPT；
2. 执行 `yarn install && yarn dev` 即可。⚠️ 注意：此命令仅用于本地开发，不要用于部署！
3. 如果你想本地部署，请使用 `yarn install && yarn build && yarn start` 命令，你可以配合 pm2 来守护进程，防止被杀死，详情询问 ChatGPT。

## 部署

### 宝塔面板部署

> [简体中文 > 如何通过宝塔一键部署](./docs/bt-cn.md)

### 容器部署 （推荐）

> Docker 版本需要在 20 及其以上，否则会提示找不到镜像。

> ⚠️ 注意：docker 版本在大多数时间都会落后最新的版本 1 到 2 天，所以部署后会持续出现“存在更新”的提示，属于正常现象。

> 建议优先阅读 AI 优化版部署文档：[docs/docker-deploy-cn.md](./docs/docker-deploy-cn.md)

#### 方式一：直接运行官方镜像

```shell
docker pull yidadaa/chatgpt-next-web

docker run -d -p 3000:3000 \
   -e OPENAI_API_KEY=sk-xxxx \
   -e CODE=页面访问密码 \
   yidadaa/chatgpt-next-web
```

如需启用 MCP 功能，可以使用：

```shell
docker run -d -p 3000:3000 \
   -e OPENAI_API_KEY=sk-xxxx \
   -e CODE=页面访问密码 \
   -e ENABLE_MCP=true \
   yidadaa/chatgpt-next-web
```

如果你需要指定其他环境变量，请自行在上述命令中增加 `-e 环境变量=环境变量值` 来指定。

#### 方式二：使用本仓库的 `docker-compose.yml` 自建镜像并部署

适用场景：

- 需要修改代码后自行部署
- 需要国内加速源
- 需要数据库 / WebDAV / SSH 隧道等扩展配置

推荐步骤如下。

1. 准备环境

```shell
docker --version
docker compose version
```

2. 复制部署环境文件

项目已提供国内服务器部署示例文件：

- Docker 部署变量示例：[.env.docker.example](./.env.docker.example)

可以直接复制：

```shell
cp .env.docker.example .env.docker
```

3. 编辑 `.env.docker`

最少需要填写：

```dotenv
OPENAI_API_KEY=sk-xxxx
CODE=你的访问密码
```

如果你在国内服务器部署，建议同时填写以下加速变量：

```dotenv
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/
RT_CLIENT_TGZ_URL=https://你自己的国内地址/rt-client-0.5.0.tgz
```

说明：

- `ALPINE_MIRROR`：Alpine `apk` 国内镜像
- `NPM_REGISTRY`：npm / yarn 国内镜像
- `RT_CLIENT_TGZ_URL`：`rt-client` 的 tgz 地址。默认走仓库内置的本地包，也可以改成你自己的 OSS / COS / CDN / 制品库地址
- 数据库默认使用 `.env.docker` 中的固定 PostgreSQL 直连配置，不默认启用 SSH 隧道
- 默认建议使用 [scripts/docker-compose-safe.sh](./scripts/docker-compose-safe.sh)
  它会自动设置 `BUILDX_CONFIG=/tmp/nextchat-docker-buildx`，避免 buildx 权限错误

4. 构建并启动生产容器

```shell
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

5. 检查服务是否正常

```shell
./scripts/docker-compose-safe.sh --env-file .env.docker ps
./scripts/docker-compose-safe.sh --env-file .env.docker logs -f chatgpt-next-web
```

如果启用了数据库同步，也可以检查健康接口：

```shell
curl http://127.0.0.1:3000/api/db/health
```

#### 首次部署、后续更新、重启的区别

- 首次部署：需要执行 `build`，时间最长
- 后续仅修改环境变量或重启服务：通常只需要 `up -d`
- 代码更新后：重新执行 `build` 再 `up -d`

常用命令：

```shell
# 重新构建并更新
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d

# 仅重启
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy restart

# 查看日志
./scripts/docker-compose-safe.sh --env-file .env.docker logs -f chatgpt-next-web

# 停止服务
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy down
```

#### 资源建议

- 仅运行已构建好的镜像：建议 `2C4G`
- 服务器上直接执行 `docker build`：建议 `4C8G`

如果只是首次在服务器上部署一次，后续长期运行，推荐做法是：

1. 在本地或 CI 构建镜像
2. 推送到国内镜像仓库
3. 服务器只执行 `docker pull` 和 `docker compose up -d`

这样会比在服务器现构建更快、更稳。

#### 这次实测确认的规则

- 国内无代理部署默认建议保持：
  `ENABLE_GOOGLE_FONTS=false`
  `ENABLE_SHAREGPT=false`
  `MCP_MARKET_URL=`
  `ENABLE_EDGE_TTS=false`
- `rt-client` 默认已经不再走 GitHub release，而是仓库内置本地包
- 生产容器需要 `HOSTNAME=0.0.0.0`
  否则 Next.js standalone 可能报 `getaddrinfo EAI_AGAIN`
- 当前生产链路已实测通过：
  `build` 成功
  `up -d` 成功
  容器内首页 `200 OK`
  `/api/db/health` 返回 `ok: true`

### 本地 Docker 开发

适用场景：

- 希望在本地使用 Docker 开发
- 修改代码后直接热更新
- 不想每次改文件都重启容器或重新构建镜像

> 更完整的 AI 优化版说明见：[docs/docker-deploy-cn.md](./docs/docker-deploy-cn.md)

直接执行：

```shell
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
```

常用命令：

```shell
# 查看开发容器日志
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f chatgpt-next-web-dev

# 仅在确实需要时重启
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev restart

# 停止本地开发容器
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

说明：

- 普通业务代码修改后，不需要重新 `build`，也不需要重启容器，开发容器内的 `next dev` 会处理热更新
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才建议重新 `build`
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认是 `false`，只有在 Docker Desktop 等环境下文件监听不稳定时再打开

#### AI 故障排查顺序

如果以后由 AI 接手部署或排障，建议按这个顺序检查：

1. 先使用 `./scripts/docker-compose-safe.sh`，不要直接跑 `docker compose build`
2. 如果构建失败，先看 `buildx` 权限、`.dockerignore` 和构建上下文
3. 如果生产容器日志报主机名解析错误，先检查 `HOSTNAME=0.0.0.0`
4. 如果宿主机访问端口异常，但容器日志正常，先在容器内 `wget http://127.0.0.1:3000`
5. 如果前端版本显示异常，先检查 `package.json` 的 `version`

### 本地部署

在控制台运行下方命令：

```shell
bash <(curl -s https://raw.githubusercontent.com/Yidadaa/ChatGPT-Next-Web/main/scripts/setup.sh)
```

⚠️ 注意：如果你安装过程中遇到了问题，请使用 docker 部署。

## 鸣谢

### 捐赠者

> 见英文版。

### 贡献者

[见项目贡献者列表](https://github.com/Yidadaa/ChatGPT-Next-Web/graphs/contributors)

### 相关项目

- [one-api](https://github.com/songquanpeng/one-api): 一站式大模型额度管理平台，支持市面上所有主流大语言模型

## 开源协议

[MIT](https://opensource.org/license/mit/)
