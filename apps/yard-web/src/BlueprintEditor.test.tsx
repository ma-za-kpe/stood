// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../test/harness.js';
import { BlueprintEditor } from './BlueprintEditor.js';
import type { EditableDraft } from './blueprint-edit.js';

const draft = (tests = 2): EditableDraft => ({
  summary: 'Booking app',
  risks: [],
  requirements: [{ id: 'book', text: 'Can book', testIds: ['a', 'b'] }],
  milestones: [1, 2, 3, 4].map((i) => ({
    id: `m${i}`,
    name: `Stage ${i}`,
    budgetMinor: 1001,
    deadline: Date.parse('2026-11-01T10:00:00Z'),
    tests: [
      { id: 'a', path: 'tests/a.test.ts', content: 'expect(a()).toBe(true);' },
      { id: 'b', path: 'tests/b.test.ts', content: 'expect(b()).toBe(true);' },
    ].slice(0, tests),
  })),
});
const editor = (over: Partial<Parameters<typeof BlueprintEditor>[0]> = {}) => {
  const props = {
    initial: draft(),
    currency: 'USD',
    capMinor: 4004,
    busy: false,
    save: vi.fn(async () => undefined),
    close: vi.fn(),
    reload: vi.fn(async () => undefined),
    ...over,
  };
  render(<BlueprintEditor {...props} />);
  return props;
};

describe('BlueprintEditor (T-0275)', () => {
  it('edits every field, keeps the cap, and saves once with a stable key', async () => {
    const props = editor();
    expect(screen.getByRole('status').textContent).toBe('Milestone total: $40.04 / approved cap $40.04.');
    fireEvent.change(screen.getByLabelText('Project summary'), { target: { value: 'Bookings for a salon' } });
    fireEvent.change(screen.getByLabelText('Name', { selector: '#edit-name-m1' }), { target: { value: 'Setup' } });
    fireEvent.change(screen.getByLabelText('Deadline (UTC)', { selector: '#edit-deadline-m1' }), {
      target: { value: '2026-11-02T09:30' },
    });
    fireEvent.change(screen.getByLabelText('tests/a.test.ts', { selector: '#edit-test-m1-0' }), {
      target: { value: 'expect(book()).toBe(true);' },
    });
    const budget = screen.getByLabelText('Budget (USD, minor units)', { selector: '#edit-budget-m1' });
    fireEvent.change(budget, { target: { value: '1000' } });
    const save = screen.getByRole('button', { name: 'Save draft for fresh review' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(budget, { target: { value: '' } });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(budget, { target: { value: '1001' } });
    expect(save).toHaveProperty('disabled', false);
    const deadline = screen.getByLabelText('Deadline (UTC)', { selector: '#edit-deadline-m2' }) as HTMLInputElement;
    fireEvent.change(deadline, { target: { value: '' } });
    expect(deadline.value).toBe('');
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(deadline, { target: { value: '2026-11-01T10:00' } });
    expect(save).toHaveProperty('disabled', false);
    vi.mocked(props.save).mockRejectedValueOnce(new Error('lost reply'));
    await act(async () => fireEvent.click(save));
    expect(screen.getByRole('alert').textContent).toMatch(/save is unresolved/);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry same edit' })));
    expect(props.save).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(props.save).mock.calls as unknown as [EditableDraft, string][];
    expect(second?.[1]).toBe(first?.[1]);
    expect(first?.[0]).toMatchObject({
      summary: 'Bookings for a salon',
      milestones: [{ name: 'Setup', deadline: Date.parse('2026-11-02T09:30:00Z') }, {}, {}, {}],
    });
    // After a save is sent the form is locked; further typing changes nothing.
    fireEvent.change(screen.getByLabelText('Project summary'), { target: { value: 'Changed later' } });
    expect((screen.getByLabelText('Project summary') as HTMLTextAreaElement).value).toBe('Bookings for a salon');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' })));
    expect(props.reload).toHaveBeenCalled();
  });

  it('merges and splits milestones, and explains a merge that cannot keep the tests', () => {
    const conflicting = draft();
    conflicting.milestones[1]!.tests[0]!.content = 'Different';
    const props = editor({ initial: conflicting });
    const merges = screen.getAllByRole('button', { name: 'Merge with next' });
    expect(merges.at(-1)).toHaveProperty('disabled', true);
    fireEvent.click(merges[0] as HTMLElement);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(merges[2] as HTMLElement);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Merge with next' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Split tests into two' })[0] as HTMLElement);
    expect(screen.getAllByRole('button', { name: 'Merge with next' })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Discard edits' }));
    expect(props.close).toHaveBeenCalled();
  });

  it('cannot split single-test milestones and stays read-only while busy', () => {
    const props = editor({ initial: draft(1), busy: true });
    expect(screen.getAllByText('Splitting needs at least two distinct acceptance tests.')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Save draft for fresh review' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft for fresh review' }));
    expect(props.save).not.toHaveBeenCalled();
  });
});
