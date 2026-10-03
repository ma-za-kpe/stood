export class Nonce {
  readonly value: string;

  constructor(code: string) {
    const value = code.toUpperCase();
    if (value.length !== 3 || !/^[A-HJ-NP-Z2-9]{3}$/.test(value)) throw new RangeError('Invalid visit code');
    this.value = value;
    Object.freeze(this);
  }

  matches(text: string): boolean {
    return text.toUpperCase() === this.value;
  }
}
