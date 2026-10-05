import { hiddenPrompt } from './adapters/local-setup/hidden-prompt.js';
import { persistEnv, readPlatformKeys, setup } from './adapters/local-setup/setup.js';

try {
  if (process.argv.slice(2).some((arg) => arg !== '--rotate-platform')) throw new Error('Unknown setup option');
  const existingPlatform = await readPlatformKeys(process.cwd());
  await setup(
    {
      existingPlatform,
      rotatePlatform: process.argv.includes('--rotate-platform'),
      prompt: (name) => hiddenPrompt(name),
      print: (message) => process.stdout.write(`${message}\n`),
      save: (keys) => persistEnv(process.cwd(), keys),
      request: (url, options) => fetch(url, options),
    },
    process.env.PAYPAL_BASE_URL,
  );
} catch {
  process.stderr.write(
    'Setup did not complete. Check your interactive terminal and sandbox keys, then retry scripts/dev setup.\n',
  );
  process.exitCode = 1;
}
