import { hiddenPrompt } from './adapters/local-setup/hidden-prompt.js';
import { persistEnv, readPlatformKeys, SetupFailure, setup } from './adapters/local-setup/setup.js';

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
} catch (error) {
  const reason =
    error instanceof SetupFailure
      ? {
          SANDBOX_KEYS_REJECTED:
            'PayPal rejected the sandbox app credentials. Check the sandbox app and re-enter its keys.',
          SANDBOX_UNAVAILABLE:
            'PayPal sandbox could not be reached or is temporarily unavailable. Retry when it is reachable.',
          SANDBOX_INVALID_RESPONSE: 'PayPal returned an unusable sandbox response. No credentials were saved.',
        }[error.code]
      : 'Setup did not complete. Check the interactive terminal, private .env and key input, then retry scripts/dev setup.';
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}
