import { hiddenPrompt } from './adapters/local-setup/hidden-prompt.js';
import { persistEnv, setup } from './adapters/local-setup/setup.js';

try {
  await setup(
    {
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
