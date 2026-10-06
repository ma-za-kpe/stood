import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { LogScanner } from '../../ports/site-log.js';
import { SiteLogError } from '../../ports/site-log.js';

const env = { PATH: '/usr/local/bin:/usr/bin:/bin', GITLEAKS_CONFIG_TOML: '[extend]\nuseDefault = true\n' };
const executable = '/usr/local/bin/gitleaks';
// Trusted composition only. Never runs a shell, reads repo configuration or writes a secret report.
export class GitleaksScanner implements LogScanner {
  private readiness: Promise<void> | null = null;
  async ready(): Promise<void> {
    if (!this.readiness)
      this.readiness = (async () => {
        try {
          const result = await promisify(execFile)(executable, ['version'], {
            env,
            cwd: '/tmp',
            timeout: 5000,
            maxBuffer: 128,
          });
          if (result.stdout.trim() !== 'v8.30.1') throw new Error('Version mismatch');
        } catch {
          throw new SiteLogError('SCAN_UNAVAILABLE');
        }
      })();
    try {
      await this.readiness;
    } catch (error) {
      this.readiness = null;
      throw error;
    }
  }
  async safe(text: string): Promise<boolean> {
    if (typeof text !== 'string' || !text || Buffer.byteLength(text) > 16384) throw new SiteLogError('INVALID_LOG');
    await this.ready();
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          'stdin',
          '--no-banner',
          '--redact=100',
          '--log-level=fatal',
          '--exit-code=10',
          '--ignore-gitleaks-allow',
          '--gitleaks-ignore-path=/dev/null',
          '--max-target-megabytes=1',
        ],
        {
          env,
          cwd: '/tmp',
          stdio: ['pipe', 'ignore', 'ignore'],
          shell: false,
        },
      );
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      const fail = () => {
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new SiteLogError('SCAN_UNAVAILABLE'));
      };
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || code === 10) resolve(code);
        else fail();
      });
      child.stdin.end(text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, ''));
    });
    return code === 0;
  }
}
