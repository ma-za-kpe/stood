import {
  type Mutation,
  YardError,
  type YardEvent,
  type YardEvents,
  type YardSnapshot,
} from '../../src/ports/events.js';
export class MemoryEvents implements YardEvents {
  snapshots = new Map<string, YardSnapshot>();
  history = new Map<string, YardEvent[]>();
  receipts = new Map<string, { fingerprint: string; result: YardSnapshot }>();
  async create(id: string, owner: string, data: unknown, key: string) {
    if (this.snapshots.has(id)) throw new YardError('CONFLICT');
    const result = { id, owner, data: structuredClone(data), version: 1 };
    this.snapshots.set(id, result);
    this.history.set(id, [
      { seq: 1, type: 'blueprint.ready', actor: owner, payload: { id }, at: '2026-10-05T00:00:00Z' },
    ]);
    this.receipts.set(`${id}:${key}`, { fingerprint: JSON.stringify({ owner, data }), result });
    return structuredClone(result);
  }
  async load(id: string) {
    const s = this.snapshots.get(id);
    if (!s) throw new YardError('NOT_FOUND');
    return structuredClone(s);
  }
  async list(after = '') {
    return [...this.snapshots.values()]
      .filter((s) => s.id > after)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 101)
      .map((s) => structuredClone(s));
  }
  async search(query: string, after = '') {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (await this.list(after)).filter((s) => {
      const names = ((s.data as { blueprint?: { milestones?: { name: string }[] } }).blueprint?.milestones ?? [])
        .map((m) => m.name.toLowerCase())
        .join(' ')
        .split(/[^a-z0-9]+/);
      return words.every((w) => names.includes(w));
    });
  }
  async read(id: string, after: number) {
    return structuredClone((this.history.get(id) ?? []).filter((e) => e.seq > after));
  }
  async mutate(
    id: string,
    version: number,
    actor: string,
    key: string,
    fingerprint: string,
    change: (data: unknown) => Mutation,
  ) {
    const s = this.snapshots.get(id);
    if (!s) throw new YardError('NOT_FOUND');
    const previous = this.receipts.get(`${id}:${key}`);
    if (previous) {
      if (previous.fingerprint !== `${actor}:${fingerprint}`) throw new YardError('CONFLICT');
      return structuredClone(previous.result);
    }
    if (s.version !== version) throw new YardError('STALE_VERSION');
    const next = change(structuredClone(s.data));
    const result = { ...s, version: version + 1, data: next.data };
    this.snapshots.set(id, result);
    this.receipts.set(`${id}:${key}`, { fingerprint: `${actor}:${fingerprint}`, result });
    this.history
      .get(id)!
      .push({ seq: result.version, type: next.type, actor, payload: next.payload, at: '2026-10-05T00:00:00Z' });
    return structuredClone(result);
  }
}
