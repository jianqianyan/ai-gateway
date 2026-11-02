FROM docker.m.daocloud.io/library/node:22-bookworm-slim AS build

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm config set registry https://registry.npmjs.org \
    && pnpm install --frozen-lockfile

COPY apps/api apps/api

RUN pnpm --filter @ai-gateway/api prisma:generate
RUN pnpm --filter @ai-gateway/api build

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["sh", "-c", "pnpm prisma:migrate:deploy && node dist/main.js"]
