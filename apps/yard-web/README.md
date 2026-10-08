# Yard web

The hosted Yard page runs at <https://stood-yard-api.onrender.com/app/>. Owner-issued access codes create secure browser sessions; the Board, events, site log and private intake use the hosted API. Stood is connected to the PayPal sandbox. Yard’s Foreman and payment connection are the next batch; no real money moves. Provider credentials and operator signing keys stay on the server.

Run `scripts/dev mock` from the repository root. It builds the app, starts the services, runs the network scenarios and checks the connected room on desktop and mobile. Screenshots are written to `artifacts/mock-network/`. The test stack is removed after the checks finish.

The Board displays public posted work, follows continuation pages and accepts server-confirmed claims. A claim changes access, so opening its room fetches a new snapshot. Switching demo operators clears private room caches. The retry key survives within one loaded offer/version; reposted work gets a new attempt key.

The first room shows persisted milestones and matching Stood capture proof. TanStack Query owns server snapshots, XState owns connection status, Zustand owns the theme, and React Hook Form/Zod own input validation. Gaps or unsupported events reload a snapshot; clicks cannot mark work paid. The ordinary transition table comes from Yard domain.

Buyers can browse StartupTribunal research or paste a full report, review the decision and caveat, then save a private intake. The hosted page disables planning until the Foreman is connected. Static Pages links to the hosted Yard. An unavailable API leaves the room disconnected with an explicit error.

Run `scripts/check-hosted-yard` to verify the production image with isolated Postgres, secure sessions, imported research, persistence, operator isolation and desktop/mobile accessibility.
