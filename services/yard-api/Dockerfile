# syntax=docker/dockerfile:1
# T-0214: hosted Yard API (Render, Starter). Build from the repository root:
#   docker build -f services/yard-api/Dockerfile .
# CI has already run every test before Render deploys (autoDeployTrigger: checksPass), so this build only compiles.
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS log-scanner

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_DEFAULT_TO_LATEST=0 COREPACK_HOME=/usr/local/share/corepack \
    npm_config_store_dir=/workspace/.pnpm-store
RUN corepack enable pnpm \
    && corepack prepare pnpm@10.32.1+sha512.a706938f0e89ac1456b6563eab4edf1d1faf3368d1191fc5c59790e96dc918e4456ab2e67d613de1043d2e8c81f87303e6b40d4ffeca9df15ef1ad567348f2be --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter "@stood/yard-api..." build \
    && pnpm --filter @stood/yard-api deploy --prod --offline /workspace/release

FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS yard-api
WORKDIR /app
COPY --from=log-scanner /usr/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=build --chown=65532:65532 /workspace/release .
ENV YARD_ENV=demo PORT=3001
EXPOSE 3001
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist/server.js"]
