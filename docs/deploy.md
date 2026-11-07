# 生产部署

> 线上环境的唯一运维说明。本地开发请看 [README 快速开始](../README.md#快速开始)。
> 本文档只写配置与流程，**不含任何凭据**：`.env`、`certs/` 与 SSH 私钥一律不入库。

## 环境概览

| 项目           | 值                                                        |
| -------------- | --------------------------------------------------------- |
| 服务器         | 腾讯云轻量 `lhins-1o4ky9pr`（广州七区，2C2G，Ubuntu 24.04） |
| 公网地址       | `43.139.238.226`                                           |
| 站点           | `https://43.139.238.226`（自签证书，首次访问需点「继续访问」） |
| 部署目录       | `/opt/my-chat`                                             |
| compose 项目名 | `mychat`（在 compose 文件内固定，避免与同机其他项目串资源） |
| compose 文件   | `deploy/docker-compose.deploy.yml`（**所有命令必须带 `-f`**） |
| SSH            | `ubuntu@43.139.238.226`，密钥 `~/.ssh/lhins_mychat_ed25519`，sudo 免密 |
| 数据库端口     | 宿主 `127.0.0.1:5444` → 容器 `5432`，仅供 SSH 隧道使用     |
| 运行时         | Docker 29.x / Compose 2.40.x（2026-11 实测）                |

容器组成：

- `mychat-app-1`：Nitro 服务，监听 `0.0.0.0:3000`，只 `expose` 不对公网开放。
- `mychat-caddy-1`：唯一对公网入口，只发布 `443`。
- `mychat-postgres-1`：`pgvector/pgvector:pg18`，带 `pgdata` 数据卷；`audio_uploads` 卷保存语音消息音频，容器重建后历史语音不会 404。

### 为什么是现在这个形态

- **只发布 443**：宿主机 `80` 已被同机其他站点的 Caddy 占用（`jintian-*` 另占 8443/8081），容器再绑 80 会直接起不来。因此没有 HTTP → HTTPS 跳转，必须显式用 `https://` 访问。
- **必须 HTTPS**：`crypto.randomUUID`、`navigator.clipboard`、`navigator.mediaDevices` 只在安全上下文存在，用 `http://IP` 直连时图片附件、复制按钮、语音录制会整片失效。ACME 不给纯 IP 签证书，所以用带 IP SAN 的自签证书（[Caddyfile](../deploy/Caddyfile) 内注释有完整原因）。
- **Caddy 按端口建站点**（`:443` 而非具名站点）：客户端按 IP 建 TLS 连接时 ClientHello 没有 SNI，具名站点会匹配不到证书。
- **postgres 限制内存参数**（`shared_buffers=96MB`、`work_mem=4MB`）：2C2G 机器要给 OS 与同机其他服务留内存，否则 pg 会按物理内存比例申请 `work_mem` 导致 OOM。

## 首次部署前置条件

服务器上需要一次性准备以下内容，之后重新部署**不要重复执行、更不要覆盖**。

1. **基础镜像**：境内拉官方源会长时间卡住，用腾讯云镜像拉取后打回 Dockerfile / compose 里写的 tag：

   ```bash
   sudo docker pull mirror.ccs.tencentyun.com/library/node:24-alpine
   sudo docker tag mirror.ccs.tencentyun.com/library/node:24-alpine node:24-alpine
   sudo docker pull mirror.ccs.tencentyun.com/pgvector/pgvector:pg18
   sudo docker tag mirror.ccs.tencentyun.com/pgvector/pgvector:pg18 pgvector/pgvector:pg18
   sudo docker pull mirror.ccs.tencentyun.com/library/caddy:2
   sudo docker tag mirror.ccs.tencentyun.com/library/caddy:2 caddy:2
   ```

   [Dockerfile](../deploy/Dockerfile) 内另外已把 apk 源换成 `mirrors.aliyun.com`、npm 源换成 `registry.npmmirror.com`，因为 `ffmpeg` 与 `tsx`/MCP SDK 走官方源在境内会卡 5 分钟以上。

2. **`deploy/.env`**（服务器专属，不入库，`-rw-------`）：compose 用 `env_file` 读取，同时供 app 容器使用。需要的键（值只在服务器维护，模板见 `.env.example`）：

   - compose 变量：`DB_USER`、`DB_PASSWORD`、`DB_NAME`
   - 应用：`APP_TITLE`、`SYSTEM_PROMPT`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`LLM_MODEL`、`ENABLE_THINKING`、`IMGBB_API_KEY`、`TAVILY_API_KEY`、`DATABASE_URL`、`AUTH_SECRET`、`NODE_ENV`、`RATE_LIMIT_MAX`

3. **自签证书** `deploy/certs/`（服务器专属，不入库）。在 `/opt/my-chat/deploy/` 下执行：

   ```bash
   mkdir -p certs
   openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
     -keyout certs/site.key -out certs/site.crt -subj "/CN=my-chat-lhins" \
     -addext "subjectAltName=IP:43.139.238.226,DNS:localhost"
   ```

   有效期 825 天，到期需重签；用 `openssl x509 -in certs/site.crt -noout -dates` 查看。

4. **目录结构**：`/opt/my-chat` 下只需 `.output/`、`deploy/`、`server/mcp/`、`server/tools/` 四部分，构建上下文就是该目录（compose 里 `context: ..`）。

## 标准部署流程（代码有变更时）

### 1. 本地验证与构建

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build          # 产出 .output/
```

`pnpm build` 会重建 `.output`；旧产物建议先改名备份（`.output` 文件数上千，直接删除容易被工具的批量删除保护拦下）。

### 2. 打包（必须跟随软链）

```bash
cd <项目根目录>
tar --dereference -czf /tmp/mychat.tar.gz \
  .output \
  deploy/Caddyfile deploy/Dockerfile deploy/docker-compose.deploy.yml \
  server/mcp/weather-server.ts server/tools/weather.ts
```

`--dereference`（即 `-h`）是硬要求：`.output` 里存在 Windows 绝对路径软链，不跟随会在 Linux 上全断并报 `ERR_MODULE_NOT_FOUND`。包里**只放上述内容**，切勿把本地 `.env`、`certs/` 打进去。

天气 MCP 以源码 + `tsx` 运行，所以这两个 `.ts` 必须随包上传，缺一不可。

### 3. 上传与解压

```bash
scp -i ~/.ssh/lhins_mychat_ed25519 /tmp/mychat.tar.gz ubuntu@43.139.238.226:/tmp/

ssh -i ~/.ssh/lhins_mychat_ed25519 ubuntu@43.139.238.226 '
  cd /opt/my-chat &&
  mv .output .output.bak.$(date +%s) &&
  tar -xzf /tmp/mychat.tar.gz
'
```

先移走旧 `.output`：tar 解压只覆盖同名文件、不删除多余文件，直接解压会留下上一版的残留。

> **绝不能覆盖或删除** `/opt/my-chat/deploy/.env` 与 `deploy/certs/`——它们在服务器上单独维护、不在仓库里，覆盖后容器会起不来或证书失效。

### 4. 构建并上线

```bash
cd /opt/my-chat
sudo docker compose -f deploy/docker-compose.deploy.yml config --quiet    # 先校验配置
sudo COMPOSE_BAKE=false DOCKER_BUILDKIT=0 docker compose -f deploy/docker-compose.deploy.yml build app
sudo COMPOSE_BAKE=false DOCKER_BUILDKIT=0 docker compose -f deploy/docker-compose.deploy.yml up -d
```

环境变量要作为 `sudo` 的赋值参数写在命令前（如上），否则 `env_reset` 会把它们丢掉，退回默认 builder 和境外源。

> `COMPOSE_BAKE=false` 在 Compose 2.40 已出现弃用告警（下个版本移除 internal compose builder）。届时去掉该变量即可：Dockerfile 内的国内源是固定的，不依赖这个开关。

### 5. 验证

```bash
sudo docker compose -f deploy/docker-compose.deploy.yml ps
curl -sk -o /dev/null -w 'home=%{http_code}\n' https://43.139.238.226/
curl -sk -o /dev/null -w 'auth=%{http_code}\n' https://43.139.238.226/api/auth/me
sudo docker logs --tail 30 mychat-app-1
```

预期：首页 200（`<title>My Chat - AI 对话助手</title>`）、`/api/auth/me` 200、postgres `healthy`、app 日志出现 `Listening on http://[::]:3000`。日志里的 `extension "vector" already exists, skipping` 是 NOTICE，不是错误。

## 无代码变更时：先核对，再决定要不要重部署

线上是否与本地 HEAD 一致，**用逐文件 sha256 清单判断，不要看时间戳**。当前 `.output` 约 839 个文件。

服务器侧生成清单：

```bash
cd /opt/my-chat/.output
find . -type f -printf '%P\n' | while IFS= read -r f; do
  printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"
done | LC_ALL=C sort > /tmp/manifest.remote
```

本地侧（Windows 无 coreutils，用 Node）：

```bash
node -e "
const fs=require('fs'),path=require('path'),c=require('crypto'),root='.output',lines=[];
(function walk(d,rel){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name),r=rel?rel+'/'+e.name:e.name;
  let isFile=e.isFile(),isDir=e.isDirectory();
  if(e.isSymbolicLink()){const s=fs.statSync(p);isFile=s.isFile();isDir=s.isDirectory()}
  if(isDir)walk(p,r);else if(isFile)lines.push(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')+'  '+r)
}})(root,'');
lines.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
process.stdout.write(lines.join('\n')+'\n');
" > /tmp/manifest.local

scp -i ~/.ssh/lhins_mychat_ed25519 /tmp/manifest.local ubuntu@43.139.238.226:/tmp/
ssh -i ~/.ssh/lhins_mychat_ed25519 ubuntu@43.139.238.226 \
  'diff /tmp/manifest.local /tmp/manifest.remote && echo IDENTICAL'
```

除 `.output` 外，还应核对 `deploy/` 三个配置文件与两个运行时 `.ts` 的哈希。全部一致时，本地构建和上传都是冗余，可跳过。

**但「无变更重部署」不是零停机**：即使 Dockerfile 和 COPY 内容完全不变，compose 构建末层的 `LABEL com.docker.compose.image.builder=classic` 也会改变镜像 ID，`up -d` 仍会 Recreate `app` 容器（caddy / postgres 不动），有数秒中断。所以没有内容变更时，更合理的是只做配置校验与健康探活，不必重建。

## 数据库 Schema 变更

修改 `server/db/schema.ts` 后，除按项目规范同步 [docs/db-schema.md](db-schema.md) 外，需要把变更推到线上库。postgres 只绑宿主回环，走 SSH 隧道：

```bash
# 终端 A：保持隧道
ssh -i ~/.ssh/lhins_mychat_ed25519 -N -L 5444:127.0.0.1:5444 ubuntu@43.139.238.226

# 终端 B：在本地项目目录执行（drizzle.config.ts 读 DATABASE_URL）
DATABASE_URL='postgresql://<DB_USER>:<DB_PASSWORD>@localhost:5444/<DB_NAME>' pnpm db:push
```

## 故障排查

| 症状 | 排查 |
| --- | --- |
| 443 打不开 | `sudo docker compose -f deploy/docker-compose.deploy.yml ps`；`sudo ss -lntp | grep 443` 看是否被宿主其他服务占用 |
| app 反复重启 | `sudo docker logs mychat-app-1`；多为 `deploy/.env` 缺键或 postgres 未 healthy |
| 语音转写 500「服务端未安装 ffmpeg」 | `sudo docker exec mychat-app-1 ffmpeg -version`，确认镜像构建时 apk 换源成功 |
| 天气工具报 `Cannot read properties of undefined (reading 'validate')` | 镜像内 `@modelcontextprotocol/sdk` / `zod` 版本被装成 v4；Dockerfile 已锁 `sdk@^1.29.0` + `zod@^3.25.76`，不要随意升级 |
| 图片/复制/录音功能失效 | 是否用 `http://` 直连；必须 `https://` 才是安全上下文 |
| 部署后历史语音 404 | `audio_uploads` 卷是否被误删 |
| 证书告警变化 / 过期 | `openssl x509 -in /opt/my-chat/deploy/certs/site.crt -noout -dates` |
| 构建卡在 `apk add` 或 `npm install` | 检查 Dockerfile 内 aliyun / npmmirror 源是否被改回官方源；基础镜像是否已按前置条件打好 tag |

## 相关文件

- [deploy/docker-compose.deploy.yml](../deploy/docker-compose.deploy.yml) — 服务、端口、卷、健康检查
- [deploy/Dockerfile](../deploy/Dockerfile) — 镜像构建、ffmpeg 与 MCP 依赖
- [deploy/Caddyfile](../deploy/Caddyfile) — TLS 与反向代理
- [docs/API.md](API.md) — 接口定义；[docs/db-schema.md](db-schema.md) — 表结构
