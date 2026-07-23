# Evergate MCP server
FROM node:22-slim
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8765
CMD ["node", "--import", "tsx", "src/index.ts"]
