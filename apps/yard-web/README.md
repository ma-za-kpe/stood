# Yard web

The connected React shell uses real Yard HTTP/SSE services with simulated providers in the isolated Docker network. No real payment is executed. Provider credentials and operator signing keys stay on the server.

Run `scripts/dev mock` from the repository root. It builds the app, starts the services, runs the network scenarios and checks the connected room on desktop and mobile. Screenshots are written to `artifacts/mock-network/`. The test stack is removed after the checks finish.

The Board displays public posted work, follows continuation pages and accepts server-confirmed claims. A claim changes access, so opening its room fetches a new snapshot. Switching demo operators clears private room caches. The retry key survives within one loaded offer/version; reposted work gets a new attempt key.

The first room shows persisted milestones and matching Stood capture proof. TanStack Query owns server snapshots, XState owns connection status, Zustand owns the theme, and React Hook Form/Zod own input validation. Gaps or unsupported events reload a snapshot; clicks cannot mark work paid. The ordinary transition table comes from Yard domain.

Hosted authentication, intake, complete work-order commands, site logs and the remaining project-room states are still in the pre-credentials batch. Static hosting alone does not provide the mock API. An unavailable API leaves the room disconnected with an explicit error.
