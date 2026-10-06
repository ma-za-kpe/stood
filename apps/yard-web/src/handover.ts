import { BUYER_HANDOVER_ITEMS } from '@stood/yard-contracts';
import type { ProjectRoom } from './project-state.js';

// Why the buyer cannot close yet. Closing never touches money; it only requires money to be settled.
export function closeBlocker(
  room: ProjectRoom,
  checked: ReadonlySet<string>,
): 'CLOSED' | 'UNPAID' | 'UNCHECKED' | null {
  if (room.handover) return 'CLOSED';
  if (!room.orders.length || room.orders.some((o) => o.state !== 'PAID')) return 'UNPAID';
  if (BUYER_HANDOVER_ITEMS.some((id) => !checked.has(id))) return 'UNCHECKED';
  return null;
}
