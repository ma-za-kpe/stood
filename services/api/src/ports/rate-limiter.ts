// T-0156: a fixed-window counter shared by every instance of the API. `hit` adds `cost` to the scope's count in the
// window that contains `now` and returns the count after it (cost 0 only reads).
export interface RateLimiter {
  hit(scope: string, cost: number, windowStart: number): Promise<number>;
}
