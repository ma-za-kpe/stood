export class SecretError extends Error {
  constructor(readonly code: 'INVALID' | 'LIVE_KEY' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE') {
    super(code);
  }
}
export type SecretEnvironment = 'TEST' | 'DEV';
// Metadata only. A secret value never leaves the vault except to a named preview deploy.
export type SecretMeta = Readonly<{
  name: string;
  provider: string;
  environment: SecretEnvironment;
  version: number;
  fingerprint: string;
  createdAt: number;
}>;
export type SecretRow = Readonly<{
  blueprintId: string;
  owner: string;
  name: string;
  provider: string;
  environment: SecretEnvironment;
  version: number;
  ciphertext: string;
  wrappedKey: string;
  kekId: string;
  fingerprint: string;
  createdAt: number;
  revokedAt: number | null;
  deleteAt: number | null;
}>;
export type SecretCommand = Readonly<{ key: string; fingerprint: string; result: SecretMeta }>;
export type SecretAudit = Readonly<{
  blueprintId: string;
  name: string;
  version: number;
  deployId: string;
  at: number;
}>;
export interface SecretRows {
  command(blueprintId: string, key: string): Promise<SecretCommand | null>;
  // Atomically records the command and makes this row the only active version of its name.
  write(row: SecretRow, command: SecretCommand): Promise<void>;
  owner(blueprintId: string): Promise<string | null>;
  active(blueprintId: string): Promise<readonly SecretRow[]>;
  current(blueprintId: string, name: string): Promise<SecretRow | null>;
  // Revocation also destroys the ciphertext and wrapped key.
  revoke(blueprintId: string, name: string, at: number): Promise<boolean>;
  schedule(blueprintId: string, deleteAt: number): Promise<void>;
  purge(now: number): Promise<number>;
  audit(entry: SecretAudit): Promise<void>;
  rewrapped(row: SecretRow, wrappedKey: string, kekId: string): Promise<void>;
  wrappedBy(kekId: string, limit: number): Promise<readonly SecretRow[]>;
  keyIdsInUse(): Promise<readonly string[]>;
}
export interface KeyWrapper {
  readonly currentId: string;
  wrap(dataKey: Buffer): Readonly<{ wrapped: string; kekId: string }>;
  unwrap(wrapped: string, kekId: string): Buffer;
  mac(data: string): string;
}
