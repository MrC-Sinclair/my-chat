# my-chat 生产镜像：直接运行本地 pnpm build 产出的 .output（不在服务器内构建，2C2G 内存不够）
# 天气 MCP 以源码 + tsx 运行，需要 server/mcp/weather-server.ts 与 server/tools/weather.ts
FROM node:24-alpine

WORKDIR /app

RUN npm install --no-audit --no-fund -g tsx \
  && npm install --no-audit --no-fund @modelcontextprotocol/sdk zod

COPY .output /app/.output
COPY server/mcp/weather-server.ts /app/server/mcp/
COPY server/tools/weather.ts /app/server/tools/

ENV NUXT_HOST=0.0.0.0 \
    NUXT_PORT=3000 \
    NODE_ENV=production

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
