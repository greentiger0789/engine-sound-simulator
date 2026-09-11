# Development tooling only; the browser application is implemented in milestone M1.
FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS tooling

WORKDIR /workspace
RUN chown node:node /workspace
USER 1000:1000
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY --chown=node:node . .
CMD ["npm", "run", "check"]
