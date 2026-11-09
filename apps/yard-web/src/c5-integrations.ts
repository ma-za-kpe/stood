import type { ProjectRoom } from './project-state.js';

export type ReviewerLedgerLine = Readonly<{
  wo: string;
  currency: string;
  builderMinor: number;
  capturedMinor: number;
  state: string;
  simulated: true;
}>;

export type AgStudioLicenseState = 'licensed' | 'expiring' | 'expired' | 'missing' | 'invalid' | 'unavailable';
export type AgStudioLicense = Readonly<{
  state: Exclude<AgStudioLicenseState, 'unavailable'>;
  expiresAt?: string;
  licenseKey?: string;
}>;
export const AG_STUDIO_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

export function agStudioLicenseState(key: string, expiresAt: string, now: number): AgStudioLicenseState {
  if (!key.trim()) return 'missing';
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 'invalid';
  if (now >= expiry) return 'expired';
  if (expiry - now <= AG_STUDIO_EXPIRY_WARNING_MS) return 'expiring';
  return 'licensed';
}

export function agStudioLicenseChecked(value: unknown): AgStudioLicense {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid AG Studio license response');
  const raw = value as Record<string, unknown>;
  if (!['licensed', 'expiring', 'expired', 'missing', 'invalid'].includes(String(raw.state)))
    throw new Error('Invalid AG Studio license state');
  if (raw.expiresAt !== undefined && (typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))))
    throw new Error('Invalid AG Studio expiry');
  if (['licensed', 'expiring'].includes(String(raw.state))) {
    if (typeof raw.licenseKey !== 'string' || !raw.licenseKey.trim() || typeof raw.expiresAt !== 'string')
      throw new Error('An active AG Studio license must have a key and expiry');
  } else if (raw.licenseKey !== undefined) {
    throw new Error('Inactive AG Studio license must not expose its key');
  }
  return {
    state: raw.state as AgStudioLicense['state'],
    ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
    ...(typeof raw.licenseKey === 'string' ? { licenseKey: raw.licenseKey } : {}),
  };
}

export function reviewerLedgerChecked(value: unknown, room: ProjectRoom): readonly ReviewerLedgerLine[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ledger response');
  const body = value as Record<string, unknown>;
  if (body.simulated !== true || !Array.isArray(body.lines) || body.lines.length !== room.orders.length)
    throw new Error('Invalid ledger response');
  const seen = new Set<string>();
  for (const raw of body.lines) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid ledger line');
    const line = raw as Record<string, unknown>;
    const order = room.orders.find((candidate) => candidate.id === line.wo);
    if (
      !order ||
      seen.has(order.id) ||
      line.currency !== room.currency ||
      line.builderMinor !== order.budgetMinor ||
      !Number.isSafeInteger(line.capturedMinor) ||
      Number(line.capturedMinor) < 0 ||
      typeof line.state !== 'string' ||
      line.simulated !== true
    )
      throw new Error('Ledger does not match this project room');
    seen.add(order.id);
  }
  return body.lines as ReviewerLedgerLine[];
}

export function reviewerSources(room: ProjectRoom, ledger: readonly ReviewerLedgerLine[]) {
  const orders = [...room.orders].sort((a, b) => a.id.localeCompare(b.id));
  const lines = new Map(ledger.map((line) => [line.wo, line]));
  return [
    {
      id: 'milestones',
      data: orders.map((order) => ({
        milestone: order.name,
        state: order.state,
        amount: order.budgetMinor / 100,
        due: new Date(order.deadline).toISOString(),
      })),
    },
    {
      id: 'reconciliation',
      data: orders.map((order) => {
        const proof = order.payment,
          ledgerLine = lines.get(order.id);
        const matched =
          ledgerLine !== undefined &&
          proof !== null &&
          proof.effect === 'CAPTURE' &&
          proof.trancheId === order.trancheId &&
          proof.minor === order.budgetMinor &&
          proof.currency === room.currency &&
          ledgerLine.capturedMinor === proof.minor;
        return {
          milestone: order.name,
          state: matched ? 'MATCHED' : proof || (ledgerLine?.capturedMinor ?? 0) > 0 ? 'MISMATCH' : 'NOT_CAPTURED',
          expected: order.budgetMinor / 100,
          captured: (ledgerLine?.capturedMinor ?? 0) / 100,
          ledgerState: ledgerLine?.state ?? 'UNKNOWN',
          reference: matched ? (proof?.reference ?? '') : '',
        };
      }),
    },
  ] as const;
}

export function timelineTasks(room: ProjectRoom) {
  return room.orders.map((order) => ({
    id: order.id,
    name: `${order.name} · ${order.state === 'PAID' ? 'released' : 'locked'}`,
    startDate: order.deadline,
    duration: 0 as const,
    milestone: true as const,
    manuallyScheduled: true as const,
    readOnly: true as const,
    locked: order.state !== 'PAID',
  }));
}
