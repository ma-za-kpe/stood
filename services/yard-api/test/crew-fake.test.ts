import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { crewScenario, fakeCrew } from './fakes/crew.js';
import { FakeRepositories } from './fakes/github.js';

describe('Crew dispatch and ordinary builder fake', () => {
  it.each([
    ['passes-first-time', 1, 'submitted'],
    ['fails-then-fixes', 2, 'submitted'],
    ['tampers-with-tests', 0, 'clocked_out'],
    ['skips-tests', 1, 'submitted'],
    ['abandons', 0, 'clocked_out'],
    ['declines-price', 0, null],
    ['lease-expires', 0, 'clocked_out'],
    ['endpoint-down', 0, null],
  ] as const)('runs %s through the normal Board without privileged payment actions', async (file, submitted, state) => {
    let now = 0;
    const github = new FakeRepositories(() => now, [{ id: 'i', owner: 'buyer' }]);
    const repo = await github.create('i', 'project', { 'tests/contract.ts': 'signed tests' });
    const token = await github.issue('i', repo.repository, 'BUILD', 'wo/one');
    const board = {
      discover: async () => [
        { id: 'one', repository: repo.repository, baseCommit: repo.commit, stack: 'node', priceMinor: 1000 },
      ],
      claim: vi.fn(async () => ({ id: 'lease', token: token.value, expiresAt: 48 * 3600000 })),
      log: vi.fn(async () => {}),
      submit: vi.fn(async (_id: string, _lease: string, _commit: string, _key: string) => {}),
      clockOut: vi.fn(async () => {}),
      status: async () => 'PUNCH_LIST' as const,
    };
    const scenario = crewScenario(
      JSON.parse(readFileSync(`services/yard-api/test/scenarios/crew/${file}.json`, 'utf8')),
    );
    const crew = fakeCrew({ clock: () => now, board, repositories: github, scenario });
    if (file === 'endpoint-down') {
      await expect(crew.poll()).rejects.toThrow();
      expect((await crew.app.request('/crew/v1/health')).status).toBe(503);
    } else {
      await crew.poll();
      await crew.tick();
      await crew.tick();
      if (file === 'lease-expires') now = 48 * 3600000;
      await crew.tick();
      await crew.tick();
      const signature = createHmac('sha256', 'sim-crew-secret')
        .update(`${now / 1000}.`)
        .digest('hex');
      const response = await crew.app.request('/crew/v1/jobs/one', {
        headers: { 'Crew-Key-Id': 'sim-crew-key', 'Crew-Signature': `t=${now / 1000},v1=${signature}` },
      });
      if (state) expect(await response.json()).toMatchObject({ state, simulated: true, paymentAuthority: false });
      else expect(response.status).toBe(404);
    }
    expect(board.submit).toHaveBeenCalledTimes(submitted);
    expect(board.claim).toHaveBeenCalledTimes(state ? 1 : 0);
  });
  it('polls without a nudge, uses a scoped repository token and submits without payment authority', async () => {
    let now = 0;
    const github = new FakeRepositories(() => now, [{ id: 'i', owner: 'buyer' }]);
    const repo = await github.create('i', 'project', { 'tests/contract.ts': 'signed tests' });
    const token = await github.issue('i', repo.repository, 'BUILD', 'wo/one');
    const offer = { id: 'one', repository: repo.repository, baseCommit: repo.commit, stack: 'node', priceMinor: 1000 };
    const status = vi.fn(async () => 'SUBMITTED' as 'SUBMITTED' | 'PUNCH_LIST');
    const board = {
      discover: vi.fn(async () => [offer]),
      claim: vi.fn(async () => ({ id: 'claim', expiresAt: 48 * 3600000, token: token.value })),
      log: vi.fn(async () => {}),
      submit: vi.fn(async (_id: string, _lease: string, _commit: string, _key: string) => {}),
      clockOut: vi.fn(async () => {}),
      status,
    };
    const scenario = crewScenario(
      JSON.parse(readFileSync('services/yard-api/test/scenarios/crew/passes-first-time.json', 'utf8')),
    );
    const crew = fakeCrew({ clock: () => now, board, repositories: github, scenario });
    await crew.poll();
    await crew.tick();
    await crew.tick();
    expect(board.claim).toHaveBeenCalledWith('one', {
      builderId: 'sim-crew',
      operatorId: 'sim-crew-operator',
      operatorRootId: 'sim-crew-operator',
    });
    expect(board.submit).toHaveBeenCalledTimes(1);
    const commit = board.submit.mock.calls[0]?.[2];
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await github.read(token.value, repo.repository, String(commit), 'tests/contract.ts')).toBe('signed tests');
    const signed = (body = '') => ({
      'Crew-Key-Id': 'sim-crew-key',
      'Crew-Signature': `t=${now / 1000},v1=${createHmac('sha256', 'sim-crew-secret')
        .update(`${now / 1000}.${body}`)
        .digest('hex')}`,
      'Idempotency-Key': 'nudge',
      'Content-Type': 'application/json',
    });
    const result = await (await crew.app.request('/crew/v1/jobs/one', { headers: signed() })).json();
    expect(result).toMatchObject({
      state: 'submitted',
      attempt: 1,
      gpu_minutes: 2,
      simulated: true,
      paymentAuthority: false,
    });
    const body = JSON.stringify({ work_order_ids: ['one'], board_url: 'http://yard-sim/yard/v1' });
    for (let i = 0; i < 2; i++)
      expect((await crew.app.request('/crew/v1/nudges', { method: 'POST', headers: signed(body), body })).status).toBe(
        202,
      );
    expect(board.claim).toHaveBeenCalledTimes(1);
    expect(
      (await crew.app.request('/crew/v1/jobs/one/cancel', { method: 'POST', headers: signed('{}'), body: '{}' }))
        .status,
    ).toBe(409);
    expect(board.clockOut).not.toHaveBeenCalled();
    expect((await crew.app.request('/crew/v1/nudges', { method: 'POST', body })).status).toBe(401);
    now += 301000;
    expect(
      (
        await crew.app.request('/crew/v1/jobs/one', {
          headers: { ...signed(), 'Crew-Signature': `t=0,v1=${'0'.repeat(64)}` },
        })
      ).status,
    ).toBe(401);
  });
});
