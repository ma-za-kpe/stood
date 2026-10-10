import { writeFileSync } from 'node:fs';
import { openApiDocument } from './http/contract.js';

// T-0053: writes openapi/stood.json from the Zod contract (`scripts/dev openapi`). The contract test fails while the
// committed file differs from what this produces, so regenerate and commit both together.
writeFileSync(
  new URL('../../../openapi/stood.json', import.meta.url),
  `${JSON.stringify(openApiDocument(), null, 2)}\n`,
);
process.stdout.write('Wrote openapi/stood.json\n');
