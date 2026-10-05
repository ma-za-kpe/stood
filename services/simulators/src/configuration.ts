export function simulatorConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const environment = env.APP_ENV ?? 'local';
  const port = Number(env.PORT ?? '8080');
  const hostname = env.SIM_BIND_HOST ?? '127.0.0.1';
  if (
    !['local', 'ci', 'demo'].includes(environment) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !['127.0.0.1', '::1', '0.0.0.0'].includes(hostname)
  )
    throw new Error('Invalid simulator configuration');
  return { environment, port, hostname };
}
