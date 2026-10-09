import { Sandbox } from '@vercel/sandbox';
import type { SandboxOptions, SandboxSession } from './vercel-sandbox.js';

// Live wiring of @vercel/sandbox 3.5.0 to the runner's session interface (ADR-0026). Credentials for the CALLER
// come from VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID; nothing of ours is passed into the VM.
// Qualified live by scripts/dev runner-check, so it is excluded from unit coverage.
export const vercelSandbox = Object.freeze({
  async create(options: SandboxOptions): Promise<SandboxSession> {
    const sandbox = await Sandbox.create({
      image: options.image,
      resources: { vcpus: options.resources.vcpus },
      timeout: options.timeout,
      persistent: options.persistent,
      networkPolicy: options.networkPolicy as never,
      // 3.5.0 does not read these from the environment by itself outside Vercel; pass the caller's own.
      token: process.env.VERCEL_TOKEN ?? '',
      teamId: process.env.VERCEL_TEAM_ID ?? '',
      projectId: process.env.VERCEL_PROJECT_ID ?? '',
    } as never);
    return {
      writeFiles: (files) => sandbox.writeFiles(files.map((f) => ({ path: f.path, content: f.content }))),
      update: ({ networkPolicy }) => sandbox.updateNetworkPolicy(networkPolicy as never).then(() => undefined),
      runCommand: async ({ cmd, args, cwd }) => {
        const finished = await sandbox.runCommand({ cmd, args: [...args], ...(cwd ? { cwd } : {}) });
        return { exitCode: finished.exitCode, stdout: () => finished.stdout(), stderr: () => finished.stderr() };
      },
      stop: () => sandbox.stop().then(() => undefined),
    };
  },
});
