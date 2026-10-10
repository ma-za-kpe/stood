import { createHash } from 'node:crypto';
import type { PackageView } from '@stood/stood-sdk';
import type { SubmissionIntent } from '../../application/board.js';
import type { PackageGateway, PackageReceipt } from '../../application/submission-bridge.js';

type Client = Readonly<{
  submitPackage(
    trancheId: string,
    input: Readonly<{
      repository: string;
      base_commit: string;
      commit_sha: string;
      report_ref: string;
      report_sha256: string;
    }>,
    key: string,
  ): Promise<PackageView>;
}>;

// The submission manifest Yard sends with each package: Stood never trusts a platform's test report and runs the
// buyer's frozen tests itself, so Yard sends what it can stand behind, the digest of exactly what it submitted.
export function submissionManifest(request: SubmissionIntent['request']) {
  const manifest = JSON.stringify([
    'yard-submission@1',
    request.trancheId,
    request.repository,
    request.baseCommit,
    request.commit,
  ]);
  return {
    ref: `yard/submissions/${request.trancheId}/${request.commit}.json`,
    sha256: createHash('sha256').update(manifest).digest('hex'),
  };
}

// T-0189: hosted package submission. The idempotency key is the submission intent's own, so a retry after a lost
// reply is the same package at Stood.
export class StoodPackageGateway implements PackageGateway {
  constructor(private readonly client: Client) {}
  async submit(request: SubmissionIntent['request']): Promise<PackageReceipt> {
    const manifest = submissionManifest(request);
    const receipt = await this.client.submitPackage(
      request.trancheId,
      {
        repository: request.repository,
        base_commit: request.baseCommit,
        commit_sha: request.commit,
        report_ref: manifest.ref,
        report_sha256: manifest.sha256,
      },
      request.key,
    );
    return {
      id: receipt.id,
      trancheId: receipt.trancheId,
      repository: receipt.metadata.repository,
      baseCommit: receipt.metadata.base_commit,
      commit: receipt.metadata.commit_sha,
    };
  }
}
