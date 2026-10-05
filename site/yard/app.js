// Illustrative fixtures only. This page has no payment or Board mutation client.
const fixtures = {
  checking: {
    stamp: 'in-review',
    verdict: 'In review',
    chip: 'checking',
    work: 'Checking',
    integrity: 'Unchanged ✓',
    run: 'Passed ✓',
    payment: 'Waiting',
    log: 'Stood proof pending',
    detail: 'Yard stays in checking.',
    sentence: 'Waiting for matching Stood confirmation. Yard cannot mark this milestone paid.',
  },
  passed: {
    stamp: 'released',
    verdict: 'Released',
    chip: 'released',
    work: 'Released by Stood (simulated)',
    integrity: 'Unchanged ✓',
    run: 'Passed ✓',
    payment: 'Confirmed · simulated',
    log: 'Matching Stood proof received',
    detail: 'Illustrative confirmed capture; no real money.',
    sentence: 'Simulated capture confirmed. This fixture shows Yard projecting a paid milestone after Stood’s proof.',
  },
  tampered: {
    stamp: 'refused',
    verdict: 'Refused',
    chip: 'punch-list',
    work: 'Punch list',
    integrity: 'Signed tests changed',
    run: 'Evidence rejected',
    payment: 'Not released',
    log: 'Stood refuses the changed tests',
    detail: 'Restore the signed tests and submit again.',
    sentence:
      'Signed tests changed. Restore the agreed test files. This refusal is illustrative; no payment was executed.',
  },
};
const setText = (id, text) => {
  document.getElementById(id).textContent = text;
};
for (const radio of document.querySelectorAll('input[name="fixture"]')) {
  radio.addEventListener('change', () => {
    const fixture = fixtures[radio.value];
    if (!fixture) return;
    const stamp = document.getElementById('stood-stamp');
    stamp.src = `../assets/brand/logo/stamp-${fixture.stamp}.svg`;
    stamp.alt = fixture.verdict;
    const chip = document.getElementById('work-chip');
    chip.src =
      fixture.chip === 'released'
        ? '../assets/brand/logo/stamp-released.svg'
        : `../assets/brand/yard/chips/${fixture.chip}.svg`;
    chip.alt = fixture.work;
    setText('integrity-check', fixture.integrity);
    setText('run-check', fixture.run);
    setText('payment-check', fixture.payment);
    setText('log-result', fixture.log);
    setText('log-detail', fixture.detail);
    setText('verdict-sentence', fixture.sentence);
  });
}
