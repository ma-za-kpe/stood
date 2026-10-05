import { paypalTransportContract } from '../../../test/contracts/paypal-transport.js';
import { FakePayPalTransport } from '../../../test/fakes/paypal.js';

paypalTransportContract('in-memory fake', async () => {
  const transport = new FakePayPalTransport();
  return { transport, input: transport.input, advance: (days) => transport.advance(days), close: async () => {} };
});
