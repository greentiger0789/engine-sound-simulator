# syntax=docker/dockerfile:1
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS tooling

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

FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 AS e2e

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

CMD ["npm", "run", "e2e"]

FROM nginx/nginx-unprivileged:1.31.9-alpine@sha256:60214a103e6f38e953ff957f34b1f2e97a9db801ab2df3821da955d0fe6cadd6 AS web

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
