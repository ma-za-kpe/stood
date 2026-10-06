import type { SecretAudit, SecretCommand, SecretRow, SecretRows } from '../../src/ports/secrets.js';

export class MemorySecretRows implements SecretRows {
  #rows: SecretRow[] = [];
  #commands = new Map<string, SecretCommand>();
  #audit: SecretAudit[] = [];
  async command(blueprintId: string, key: string) {
    return this.#commands.get(`${blueprintId}\0${key}`) ?? null;
  }
  async write(row: SecretRow, command: SecretCommand) {
    const id = `${row.blueprintId}\0${command.key}`;
    if (this.#commands.has(id)) throw new Error('duplicate command');
    this.#rows = this.#rows.map((r) =>
      r.blueprintId === row.blueprintId && r.name === row.name && r.revokedAt === null
        ? { ...r, revokedAt: row.createdAt, ciphertext: '', wrappedKey: '' }
        : r,
    );
    this.#rows.push(row);
    this.#commands.set(id, command);
  }
  async owner(blueprintId: string) {
    return this.#rows.find((r) => r.blueprintId === blueprintId)?.owner ?? null;
  }
  async active(blueprintId: string) {
    return this.#rows.filter((r) => r.blueprintId === blueprintId && r.revokedAt === null);
  }
  async current(blueprintId: string, name: string) {
    return (
      this.#rows
        .filter((r) => r.blueprintId === blueprintId && r.name === name)
        .sort((a, b) => b.version - a.version)[0] ?? null
    );
  }
  async revoke(blueprintId: string, name: string, at: number) {
    let found = false;
    this.#rows = this.#rows.map((r) => {
      if (r.blueprintId !== blueprintId || r.name !== name || r.revokedAt !== null) return r;
      found = true;
      return { ...r, revokedAt: at, ciphertext: '', wrappedKey: '' };
    });
    return found;
  }
  async schedule(blueprintId: string, deleteAt: number) {
    this.#rows = this.#rows.map((r) => (r.blueprintId === blueprintId ? { ...r, deleteAt } : r));
  }
  async purge(now: number) {
    const before = this.#rows.length;
    this.#rows = this.#rows.filter((r) => r.deleteAt === null || r.deleteAt > now);
    return before - this.#rows.length;
  }
  async audit(entry: SecretAudit) {
    this.#audit.push({ ...entry });
  }
  async rewrapped(row: SecretRow, wrappedKey: string, kekId: string) {
    this.#rows = this.#rows.map((r) =>
      r.blueprintId === row.blueprintId && r.name === row.name && r.version === row.version
        ? { ...r, wrappedKey, kekId }
        : r,
    );
  }
  async wrappedBy(kekId: string, limit: number) {
    return this.#rows.filter((r) => r.kekId === kekId && r.wrappedKey).slice(0, limit);
  }
  async keyIdsInUse() {
    return [...new Set(this.#rows.filter((r) => r.wrappedKey).map((r) => r.kekId))];
  }
  // Test helpers only.
  dump() {
    return structuredClone(this.#rows);
  }
  audited() {
    return structuredClone(this.#audit);
  }
  swapCiphertext(blueprintId: string, a: string, b: string) {
    const x = this.#rows.find((r) => r.blueprintId === blueprintId && r.name === a && r.revokedAt === null);
    const y = this.#rows.find((r) => r.blueprintId === blueprintId && r.name === b && r.revokedAt === null);
    if (!x || !y) throw new Error('missing rows');
    this.#rows = this.#rows.map((r) => (r === x ? { ...r, ciphertext: y.ciphertext, wrappedKey: y.wrappedKey } : r));
  }
}
