const currencies = new Set(['GBP', 'USD', 'EUR', 'GHS', 'NGN', 'KES', 'UGX']);

export class Money {
  readonly minor: bigint;
  readonly currency: string;

  constructor(minor: bigint, currency: string) {
    if (typeof minor !== 'bigint' || minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Money requires nonnegative, exactly serializable integer minor units');
    }
    if (!currencies.has(currency)) throw new RangeError('Unsupported currency');
    this.minor = minor;
    this.currency = currency;
    Object.freeze(this);
  }

  add(other: Money): Money {
    this.requireCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.requireCurrency(other);
    if (other.minor > this.minor) throw new RangeError('Subtraction would produce a negative amount');
    return new Money(this.minor - other.minor, this.currency);
  }

  toJSON(): { minor: number; currency: string } {
    return { minor: Number(this.minor), currency: this.currency };
  }

  private requireCurrency(other: Money): void {
    if (this.currency !== other.currency) throw new RangeError('Currency conversion must be explicit');
  }
}
