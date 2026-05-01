# CLAUDE.local.md

个人项目偏好，**不应提交到 Git**。确保 `.gitignore` 中包含 `CLAUDE.local.md` 和 `.env`。

## LLM Provider

本地默认使用硅基流动（SiliconFlow），国内直连无需代理。切换模型只需改 `.env` 中的 `LLM_MODEL`，不改代码。

当前可用模型（`server/config/models.ts`）：
- `Qwen/Qwen3-8B`（默认）
- `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`
- `THUDM/GLM-4.1V-9B-Thinking`

## Personal Preferences

- 调试 AI 请求时查看终端的 `console.error` 输出
- 优先使用中文回复
- 代码注释使用中文（除非明确要求英文）

## Image Chat (图片对话)

- 图床使用 **ImgBB**（免费），API Key 硬编码在 `server/utils/imgbb.ts`
- 硅基流动不支持 base64 图片，必须先上传到图床获取公网 URL
- 仅 `THUDM/GLM-4.1V-9B-Thinking` 支持图片理解
- GLM-4.1V 模型不支持 `enable_thinking` 参数（自带思考能力）

## Local Development

- 数据库：Docker PostgreSQL，开发端口 5434，测试端口 5433
- 启动顺序：`docker compose up -d` → `pnpm db:push` → `pnpm dev`
- Drizzle Studio：`pnpm db:studio` 可视化查看数据库
- Windows 环境：Vite 中间件已修复非 ASCII 路径问题，无需额外处理

## Git Reminders

- 提交前删除临时 `console.log`
- `.env` 文件不应提交（当前 `.gitignore` 只排除了 `.env.local`，建议补充 `.env`）
- `CLAUDE.local.md` 不应提交
