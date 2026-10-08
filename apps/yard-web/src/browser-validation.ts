import { z } from 'zod';

// Run before constructing shared schemas: Zod's optional eval probe violates the hosted CSP.
// Its existing interpreter performs the same validation without dynamic compilation.
z.config({ jitless: true });
