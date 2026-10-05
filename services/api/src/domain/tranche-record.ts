import { RULE_SET_VERSION } from './decision.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { Tranche } from './tranche.js';

export type TrancheDefinition = Readonly<{
  id: string;
  amount: Readonly<{ minor: number; currency: string }>;
  profileId: string;
  maxResubmits: number;
}>;
const arity = {
  fundingFailed: 0,
  dispatch: 4,
  startDeciding: 0,
  beginSettlement: 3,
  confirmSettlement: 1,
  settlementFailed: 1,
  claimCaptureRetry: 1,
  beginReauthorization: 1,
  confirmReauthorization: 1,
  reauthorizationFailed: 1,
  expire: 1,
  redispatch: 0,
  dispute: 0,
  cancel: 1,
  confirmNoRenewalExpiry: 1,
} as const;
type Method = keyof typeof arity;
export type TrancheCommand = {
  [M in Method]: Readonly<{
    method: M;
    args: M extends 'dispatch' ? readonly [string, string, number, number] : Readonly<Parameters<Tranche[M]>>;
  }>;
}[Method];
type RecordDocument = Readonly<{
  schemaVersion: 1;
  ruleSetVersion: string;
  definition: TrancheDefinition;
  commands: readonly TrancheCommand[];
}>;

export function createTrancheRecord(definition: TrancheDefinition): string {
  const record = JSON.stringify({ schemaVersion: 1, ruleSetVersion: RULE_SET_VERSION, definition, commands: [] });
  restoreTrancheRecord(record);
  return record;
}

export function advanceTrancheRecord(record: string, command: TrancheCommand): string {
  const document = JSON.parse(record) as RecordDocument;
  const copy = JSON.parse(JSON.stringify(command)) as TrancheCommand;
  replay(restoreTrancheRecord(record), copy);
  return JSON.stringify({ ...document, commands: [...document.commands, copy] });
}

export function restoreTrancheRecord(record: string): Tranche {
  const document = JSON.parse(record) as RecordDocument;
  if (
    document?.schemaVersion !== 1 ||
    !supportedVersion(document.ruleSetVersion) ||
    !Array.isArray(document.commands) ||
    !Number.isSafeInteger(document.definition?.amount?.minor)
  )
    throw new RangeError('Invalid or incompatible tranche record');
  const { id, amount, profileId, maxResubmits } = document.definition;
  return Tranche.recover(
    id,
    new Money(BigInt(amount.minor), amount.currency),
    profileId,
    maxResubmits,
    document.ruleSetVersion,
    (tranche) => {
      for (const command of document.commands) replay(tranche, command);
    },
  );
}

function supportedVersion(version: unknown): boolean {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return false;
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const current = RULE_SET_VERSION.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (parts[index] !== current[index]) return (parts[index] as number) < (current[index] as number);
  }
  return true;
}

function replay(tranche: Tranche, command: TrancheCommand) {
  const args: unknown = command?.args;
  if (
    !command ||
    !Object.hasOwn(arity, command.method) ||
    !Array.isArray(args) ||
    args.length !== arity[command.method]
  )
    throw new RangeError('Invalid tranche command');
  switch (command.method) {
    case 'fundingFailed':
      return tranche.fundingFailed(...command.args);
    case 'dispatch':
      return tranche.dispatch(command.args[0], new Nonce(command.args[1]), command.args[2], command.args[3]);
    case 'startDeciding':
      return tranche.startDeciding(...command.args);
    case 'beginSettlement':
      return tranche.beginSettlement(...command.args);
    case 'confirmSettlement':
      return tranche.confirmSettlement(...command.args);
    case 'claimCaptureRetry':
      return tranche.claimCaptureRetry(...command.args);
    case 'settlementFailed':
      return tranche.settlementFailed(...command.args);
    case 'beginReauthorization':
      return tranche.beginReauthorization(...command.args);
    case 'confirmReauthorization':
      return tranche.confirmReauthorization(...command.args);
    case 'reauthorizationFailed':
      return tranche.reauthorizationFailed(...command.args);
    case 'expire':
      return tranche.expire(...command.args);
    case 'redispatch':
      return tranche.redispatch(...command.args);
    case 'dispute':
      return tranche.dispute(...command.args);
    case 'cancel':
      return tranche.cancel(...command.args);
    case 'confirmNoRenewalExpiry':
      return tranche.confirmNoRenewalExpiry(...command.args);
  }
}
