// Keyboard movement across Board cards: arrows step, Home/End jump; anything else is not handled.
export function nextCard(index: number, key: string, count: number): number | null {
  if (count < 1 || index < 0 || index >= count) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, index + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
// "47h 59m left" style countdown for a lease; "Lease ended" once it has passed.
export function leaseRemaining(until: number, now: number): string {
  if (!Number.isSafeInteger(until) || !Number.isSafeInteger(now)) return 'Lease time unknown';
  const minutes = Math.floor((until - now) / 60000);
  if (minutes <= 0) return 'Lease ended';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m left on the lease` : `${minutes}m left on the lease`;
}
