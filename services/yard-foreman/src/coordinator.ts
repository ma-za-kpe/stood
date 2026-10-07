import { type BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';

export interface ForemanCoordinator {
  run<T>(id: string, work: () => Promise<T>): Promise<T>;
}
const queues = new WeakMap<BaseCheckpointSaver, Map<string, Promise<void>>>();
// Only in-memory checkpoints may use process-local coordination. Durable
// compositions must supply a coordinator shared by every writer.
export function memoryCoordinator(checkpoint: BaseCheckpointSaver): ForemanCoordinator {
  if (!(checkpoint instanceof MemorySaver)) throw new Error('COORDINATOR_REQUIRED');
  let pending = queues.get(checkpoint);
  if (!pending) {
    pending = new Map();
    queues.set(checkpoint, pending);
  }
  const queue = pending;
  return {
    async run<T>(id: string, work: () => Promise<T>): Promise<T> {
      const previous = queue.get(id) ?? Promise.resolve();
      let release!: () => void;
      const tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      queue.set(id, tail);
      await previous;
      try {
        return await work();
      } finally {
        release();
        if (queue.get(id) === tail) queue.delete(id);
      }
    },
  };
}
