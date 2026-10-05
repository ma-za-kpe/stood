# ADR-0008: SeaweedFS for local S3 development

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

T15 specifies MinIO for local S3. Pulls of `minio/minio:RELEASE.2025-09-07T16-13-09Z` and `minio/minio:RELEASE.2025-04-22T22-12-26Z` failed with repository/access errors; the Quay alternatives also failed. Docker and the other images are reachable.

## Decision

Use digest-pinned SeaweedFS 4.17 as the local S3 service. Its [official repository](https://github.com/seaweedfs/seaweedfs) documents the S3 server. Keep Cloudflare R2 as the hosted target. Local services bind to loopback and contain synthetic data only.

## Alternatives considered

- Build MinIO from source: more onboarding work before testing the domain.
- Use R2 for every test: introduces credentials, network dependence and shared state.

## Risks and controls

S3 implementations differ. Test the actual object-store operations against R2 before claiming adapter contract compatibility. Local object storage is not production infrastructure.

## Reversal condition

The local service cannot implement an object-store operation Stood needs, or a maintained MinIO image becomes available and provides better test parity.
