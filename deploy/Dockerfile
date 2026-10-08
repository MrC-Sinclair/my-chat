# my-chat 生产镜像：直接运行本地 pnpm build 产出的 .output（不在服务器内构建，2C2G 内存不够）
# 天气 MCP 以源码 + tsx 运行，需要 server/mcp/weather-server.ts 与 server/tools/weather.ts
FROM node:24-alpine

WORKDIR /app

# ffmpeg/ffprobe 是语音转写（/api/audio/transcribe）的硬依赖：WebM→16k mono WAV 转码、实测时长。
# 缺失时该路由直接 500「服务端未安装 ffmpeg」
RUN apk add --no-cache ffmpeg

# 版本必须与 package.json 锁定一致：MCP SDK 1.x 的 schema 转换依赖 zod v3 的 .validate，
# 不固定版本会装到 zod v4 / SDK 2.x，天气工具调用报 "Cannot read properties of undefined (reading 'validate')"
RUN npm install --no-audit --no-fund -g tsx \
  && npm install --no-audit --no-fund @modelcontextprotocol/sdk@^1.29.0 zod@^3.25.76

COPY .output /app/.output
COPY server/mcp/weather-server.ts /app/server/mcp/
COPY server/tools/weather.ts /app/server/tools/

ENV NUXT_HOST=0.0.0.0 \
    NUXT_PORT=3000 \
    NODE_ENV=production

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
