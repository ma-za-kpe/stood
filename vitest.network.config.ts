import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

// Stood scenarios advance the shared clock by days. Seed the connected Yard
// examples afterward, so the retained demo never presents already-expired work.
class NetworkChronology extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const rank = (file: TestSpecification) => {
      if (file.moduleId.endsWith('/yard-lease.network.test.ts')) return 3;
      if (file.moduleId.endsWith('/yard-first.network.test.ts')) return 2;
      if (file.moduleId.endsWith('/yard-foreman.network.test.ts')) return 1;
      return 0;
    };
    return [...files].sort((a, b) => rank(a) - rank(b) || a.moduleId.localeCompare(b.moduleId));
  }
}
export default defineConfig({
  test: {
    include: ['services/**/*.network.test.ts'],
    fileParallelism: false,
    sequence: { sequencer: NetworkChronology },
    testTimeout: 20000,
  },
});
