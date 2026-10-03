# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dev
RUN npm install --global pnpm@10.32.1 \
    && mkdir -p /workspace/node_modules \
    && chown -R node:node /workspace
WORKDIR /workspace
USER node
CMD ["pnpm", "test"]

FROM dev AS build
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile && pnpm validate
RUN pnpm --filter @stood/api deploy --prod --legacy /workspace/release

FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:14d42e2511532589a7c7e01a753667a74fcc96266e137e8125006b87b0c32d0a AS api
WORKDIR /app
COPY --from=build --chown=65532:65532 /workspace/release .
ENV APP_ENV=demo PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com PORT=3000
EXPOSE 3000
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["dist/server.js"]
