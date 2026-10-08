import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrlProblem } from './adapters/db-postgres/connection-policy.js';
import { PostgresMandates } from './adapters/db-postgres/mandates.js';
import * as schema from './adapters/db-postgres/schema.js';
import { TokenCipher } from './adapters/db-postgres/token-cipher.js';

// Operator tool (T-0227): re-seal every saved PayPal token under the newest VAULT_TOKEN_KEYS key.
//   vault-keys-cli.js rotate
const url = process.env.DATABASE_URL?.trim() ?? '';
const problem = url ? databaseUrlProblem(url, process.env.APP_ENV ?? 'local') : 'DATABASE_URL is missing';
if (problem || process.argv[2] !== 'rotate') {
  process.stderr.write(`${problem ?? 'Usage: vault-keys-cli.js rotate'}\n`);
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const cipher = new TokenCipher(process.env.VAULT_TOKEN_KEYS ?? '');
  const rotated = await new PostgresMandates(drizzle(pool, { schema }), cipher).rotateTokens();
  process.stdout.write(`Re-sealed ${rotated} saved token(s) under the newest key.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Rotation failed'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
