# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@11.25.0 && pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24-bookworm-slim AS api
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/domain ./packages/domain
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
WORKDIR /app/apps/api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATABASE_PATH=/data/punchin.sqlite
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["../../node_modules/.bin/tsx", "src/main.ts"]

FROM caddy:2 AS web
COPY --from=build /app/apps/employee/dist /srv/employee
COPY --from=build /app/apps/admin/dist /srv/admin
COPY deploy/Caddyfile /etc/caddy/Caddyfile
