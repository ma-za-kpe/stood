# syntax=docker/dockerfile:1
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS log-scanner

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dev
COPY --from=log-scanner /usr/bin/gitleaks /usr/local/bin/gitleaks
ARG DEV_UID=1000
ARG DEV_GID=1000
RUN npm install --global pnpm@10.32.1 \
    && groupmod --gid "$DEV_GID" node \
    && usermod --uid "$DEV_UID" --gid "$DEV_GID" node \
    && mkdir -p /workspace/node_modules \
    && chown -R node:node /workspace
WORKDIR /workspace
USER node
CMD ["pnpm", "test"]

FROM dev AS build
# One store for install, the release test and the release itself: `pnpm store path` must agree with them.
ENV npm_config_store_dir=/workspace/.pnpm-store
# Render's builder is slower than CI and builds both services at once; give each test more time.
ENV STOOD_TEST_TIMEOUT_MS=30000
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile && pnpm validate
RUN pnpm --filter @stood/api deploy --prod --offline /workspace/release

FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS api
WORKDIR /app
COPY --from=build --chown=65532:65532 /workspace/release .
ENV APP_ENV=demo PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com PORT=3000
EXPOSE 3000
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist/server.js"]
