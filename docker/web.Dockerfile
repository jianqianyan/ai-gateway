FROM docker.m.daocloud.io/library/node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm config set registry https://registry.npmjs.org \
    && pnpm install --frozen-lockfile

COPY apps/web apps/web

RUN pnpm --filter @ai-gateway/web build

FROM docker.m.daocloud.io/library/node:22-bookworm-slim

WORKDIR /app
COPY docker/web-server.mjs ./
COPY --from=build /app/apps/web/dist ./dist

ENV PORT=80
EXPOSE 80
CMD ["node", "web-server.mjs"]
