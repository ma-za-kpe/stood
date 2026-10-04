import { createInterface } from 'node:readline';
import { type Readable, Writable } from 'node:stream';

export async function hiddenPrompt(
  name: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  interactive: boolean = process.stdin.isTTY === true,
): Promise<string> {
  if (!interactive) throw new Error('Setup requires an interactive terminal');
  output.write(`${name}: `);
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const reader = createInterface({ input, output: muted, terminal: true });
  try {
    return await new Promise<string>((resolve, reject) => {
      reader.once('SIGINT', () => reject(new Error('Setup cancelled')));
      reader.once('close', () => reject(new Error('Setup input closed')));
      reader.question('', resolve);
    });
  } finally {
    reader.close();
    muted.end();
    output.write('\n');
  }
}
