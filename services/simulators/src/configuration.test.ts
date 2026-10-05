import { expect, it } from 'vitest';
import { simulatorConfiguration } from './configuration.js';

it('binds standalone simulation to loopback, and requires an explicit Docker bind', () => {
  expect(simulatorConfiguration({}).hostname).toBe('127.0.0.1');
  expect(simulatorConfiguration({ SIM_BIND_HOST: '0.0.0.0' }).hostname).toBe('0.0.0.0');
  for (const env of [{ APP_ENV: 'production' }, { PORT: '0' }, { PORT: '65536' }, { SIM_BIND_HOST: '192.168.1.5' }])
    expect(() => simulatorConfiguration(env)).toThrow();
});
