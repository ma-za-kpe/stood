export class IntakeError extends Error {
  constructor(readonly code: 'INVALID_INTAKE' | 'CREDENTIAL_IN_INTAKE') {
    super(code);
  }
}
// Defence against accidental pasting, not provider/environment qualification.
// These patterns accept no keys: test credentials belong in the later vault too.
const credentials = [
  /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i,
  /\b(?:gh[pousr]_|github_pat_|sk[-_](?:live|test|proj|ant)[_-]|rk_(?:live|test)_)[a-z0-9_-]+/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /["']?(?:client_secret|private_key|api_key|access_token|secret_access_key)["']?\s*[:=]\s*["']?[^\s"',}]{8,}/i,
];
export function assertPublicInput(value: unknown, boundary: 'INTAKE' | 'MODEL' | 'IMPORT' = 'INTAKE'): void {
  if (boundary !== 'INTAKE' && boundary !== 'MODEL' && boundary !== 'IMPORT') throw new IntakeError('INVALID_INTAKE');
  const maxBytes = boundary === 'IMPORT' ? 131072 : boundary === 'MODEL' ? 65536 : 49152;
  let raw: string;
  try {
    raw = JSON.stringify(value) ?? '';
  } catch {
    throw new IntakeError('INVALID_INTAKE');
  }
  if (!raw || new TextEncoder().encode(raw).length > maxBytes) throw new IntakeError('INVALID_INTAKE');
  const normalised = raw.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (credentials.some((pattern) => pattern.test(normalised))) throw new IntakeError('CREDENTIAL_IN_INTAKE');
}
