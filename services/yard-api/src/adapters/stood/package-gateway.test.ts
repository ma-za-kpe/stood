import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StoodPackageGateway, submissionManifest } from './package-gateway.js';

const request = {
  trancheId: 'trn_1',
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  key: 'yard-submit:1',
};
// T-0189: hosted package submission sends Stood the exact commit and Yard's reproducible submission digest.
describe('StoodPackageGateway', () => {
  it('submits the exact commit with the intent key and reads back Stood’s package receipt', async () => {
    const submitPackage = vi.fn(async (trancheId: string, input: Record<string, string>) => ({
      id: 'pkg_1',
      trancheId,
      status: 'QUEUED' as const,
      waitingFor: 'RUNNER' as const,
      metadata: input as never,
      createdAt: '2026-10-10T00:00:00.000Z',
    }));
    const receipt = await new StoodPackageGateway({ submitPackage }).submit(request);
    expect(receipt).toEqual({
      id: 'pkg_1',
      trancheId: 'trn_1',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      commit: 'b'.repeat(40),
    });
    const manifest = createHash('sha256')
      .update(JSON.stringify(['yard-submission@1', 'trn_1', 'buyer/project', 'a'.repeat(40), 'b'.repeat(40)]))
      .digest('hex');
    expect(submitPackage).toHaveBeenCalledWith(
      'trn_1',
      {
        repository: 'buyer/project',
        base_commit: 'a'.repeat(40),
        commit_sha: 'b'.repeat(40),
        report_ref: `yard/submissions/trn_1/${'b'.repeat(40)}.json`,
        report_sha256: manifest,
      },
      'yard-submit:1',
    );
    expect(submissionManifest(request).sha256).toBe(manifest);
    expect(submissionManifest({ ...request, commit: 'c'.repeat(40) }).sha256).not.toBe(manifest);
  });
});
