// Y20 §5: the handover rotation checklist. Yard's own items are done by the system and shown as done;
// the buyer confirms theirs. Closing the project never waits on, or changes, Stood's money decision.
export type HandoverItem = Readonly<{ id: string; owner: 'BUYER' | 'YARD'; label: string }>;
export const HANDOVER_CHECKLIST: readonly HandoverItem[] = Object.freeze(
  [
    {
      id: 'production-secrets-own-hosting',
      owner: 'BUYER',
      label: 'Production secrets were entered directly in my own hosting, never sent to Yard.',
    },
    { id: 'rotate-test-keys', owner: 'BUYER', label: 'I rotated or deleted every test key I gave Yard.' },
    {
      id: 'yard-deletes-stored-keys',
      owner: 'YARD',
      label: 'Yard deletes its stored copies of my keys within 7 days.',
    },
    { id: 'previews-deleted', owner: 'YARD', label: 'All preview services and preview databases are deleted.' },
    { id: 'builder-access-removed', owner: 'YARD', label: 'Builder access to the repository is removed.' },
    {
      id: 'github-app-decision',
      owner: 'BUYER',
      label: 'I kept or uninstalled the Yard GitHub App on purpose.',
    },
    {
      id: 'remove-preview-trust',
      owner: 'BUYER',
      label: 'I removed any cloud trust or role that existed only for previews.',
    },
    {
      id: 'mfa-and-billing-alerts',
      owner: 'BUYER',
      label: 'MFA and billing alerts are on for my hosting and cloud accounts.',
    },
    {
      id: 'rotate-exposed-keys',
      owner: 'BUYER',
      label: 'I rotated any test key that was ever pasted somewhere unexpected.',
    },
  ].map((item) => Object.freeze(item as HandoverItem)),
);
export const BUYER_HANDOVER_ITEMS: readonly string[] = Object.freeze(
  HANDOVER_CHECKLIST.filter((i) => i.owner === 'BUYER').map((i) => i.id),
);
export function handoverConfirmation(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join() !== 'confirmed')
    throw new RangeError('Invalid handover confirmation');
  const confirmed = (value as { confirmed: unknown }).confirmed;
  if (
    !Array.isArray(confirmed) ||
    confirmed.length !== BUYER_HANDOVER_ITEMS.length ||
    new Set(confirmed).size !== confirmed.length ||
    confirmed.some((id) => typeof id !== 'string' || !BUYER_HANDOVER_ITEMS.includes(id))
  )
    throw new RangeError('Every buyer checklist item must be confirmed');
  return Object.freeze([...confirmed].sort());
}
