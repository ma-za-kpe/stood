/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  accessTokenAuthenticationProvider,
  compositeAuthenticationProvider,
  customHeaderAuthenticationProvider,
} from './authentication.js';
import { Configuration } from './configuration.js';

export function createAuthProviderFromConfig(config: Partial<Configuration>) {
  const authConfig = {
    platformKey:
      config.platformKeyCredentials &&
      accessTokenAuthenticationProvider(config.platformKeyCredentials),
    requestSignature:
      config.requestSignatureCredentials &&
      customHeaderAuthenticationProvider(config.requestSignatureCredentials),
  };

  return compositeAuthenticationProvider<
    keyof typeof authConfig,
    typeof authConfig
  >(authConfig);
}
