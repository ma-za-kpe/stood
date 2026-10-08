import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { databaseUrlProblem } from './adapters/db-postgres/connection-policy.js';
import { PostgresReconciliationFindings } from './adapters/db-postgres/reconciliation-findings.js';
import * as schema from './adapters/db-postgres/schema.js';

// Operator tool (T-0257): list open reconciliation findings, or resolve one for good with a name and reason.
//   findings-cli.js list
//   findings-cli.js resolve <id> --by <name> --note "<reason>"
const [command, id] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? '') : '';
};
const url = process.env.DATABASE_URL?.trim() ?? '';
const problem = url ? databaseUrlProblem(url, process.env.APP_ENV ?? 'local') : 'DATABASE_URL is missing';
if (problem || (command !== 'list' && command !== 'resolve')) {
  process.stderr.write(`${problem ?? 'Usage: findings-cli.js list | resolve <id> --by <name> --note "<reason>"'}\n`);
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const findings = new PostgresReconciliationFindings(drizzle(pool, { schema }));
  if (command === 'list') {
    const open = await findings.open();
    if (!open.length) process.stdout.write('No open findings.\n');
    for (const f of open)
      process.stdout.write(
        `${f.id}  ${f.kind}  capture=${f.providerId ?? '-'}  operation=${f.operationKey ?? '-'}  opened=${f.openedAt}\n`,
      );
  } else {
    await findings.resolveByPerson(id ?? '', flag('--by'), flag('--note'));
    process.stdout.write(`Resolved ${id} by ${flag('--by')}.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Findings unavailable'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
