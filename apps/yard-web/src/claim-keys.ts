// Browser getRandomValues also works on the isolated HTTP Docker test origin.
// An attempt is bound to the loaded offer version; a repost is a new attempt.
export class ClaimKeys {
  private readonly keys = new Map<string, string>();
  constructor(private readonly random = () => crypto.getRandomValues(new Uint8Array(16))) {}
  for(id: string, version: number): string {
    const identity = `${id}:${version}`;
    let key = this.keys.get(identity);
    if (!key) {
      key = `web:${Array.from(this.random(), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      this.keys.set(identity, key);
    }
    return key;
  }
}

export const browserRequestKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
