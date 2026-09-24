FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8484
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v1.22.22 /var/cache/apk \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY package.json ./
COPY src ./src

FROM scratch
COPY --from=runtime / /
ENV NODE_ENV=production
ENV PORT=8484
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app
EXPOSE 8484
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8484/health || exit 1

CMD ["node", "src/server.ts"]
