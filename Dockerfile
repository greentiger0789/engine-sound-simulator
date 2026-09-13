# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS tooling

WORKDIR /workspace
RUN chown node:node /workspace
USER 1000:1000
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .

FROM tooling AS build

RUN npm run build

FROM tooling AS e2e-harness

RUN npm run build:e2e-harness

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 AS e2e

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

CMD ["npm", "run", "e2e"]

FROM nginxinc/nginx-unprivileged:1.31.5-alpine@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1 AS web

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]

FROM web AS e2e-web

COPY --from=e2e-harness /workspace/dist-e2e /usr/share/nginx/html/__e2e__
# The Worklet can share emitted chunks with the product entry. Copy its complete
# asset graph under the harness base instead of assuming a single-file bundle.
COPY --from=build /workspace/dist/assets \
  /usr/share/nginx/html/__e2e__/assets
