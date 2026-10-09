import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calc, isValidGstin, formatNumber, diffDays, addDays, fmtT, hm, inr, fyLabel } from './index';

test('GST is split CGST+SGST within the state and IGST across states', () => {
  const lines = [{ d: 'Senior engineer', qty: 10, unit: 'day', rate: 28000, disc: 0, sac: '998314' }, { d: 'PM', qty: 1, unit: 'fixed', rate: 40000, disc: 0, sac: '998314' }];
  const intra = calc(lines, 'Karnataka', 'Karnataka');
  assert.equal(intra.taxable, 320000); assert.equal(intra.tax, 57600); assert.equal(intra.grand, 377600);
  assert.deepEqual(intra.taxRows, [['CGST 9%', 28800], ['SGST 9%', 28800]]);
  const inter = calc(lines, 'Maharashtra', 'Karnataka');
  assert.deepEqual(inter.taxRows, [['IGST 18%', 57600]]);
});
test('discounts reduce the taxable value', () => {
  const k = calc([{ d: 'x', qty: 1, unit: 'fixed', rate: 272727, disc: 12, sac: '998319' }], 'Tamil Nadu', 'Karnataka');
  assert.equal(k.disc, 32727); assert.equal(k.taxable, 240000); assert.equal(k.maxDisc, 12);
});
test('GSTIN validation', () => {
  assert.ok(isValidGstin('29AADCH7713P1ZQ')); assert.ok(!isValidGstin('99AADCH7713P1ZQ')); assert.ok(!isValidGstin('29AADCH'));
});
test('numbering patterns', () => {
  assert.equal(formatNumber({ prefix: 'INV', pattern: '{prefix}-{yyyy}-{seq}', padding: 4, next: 143 }, '2026-10-08'), 'INV-2026-0143');
  assert.equal(formatNumber({ prefix: 'INV', pattern: '{prefix}/{fy}/{seq}', padding: 3, next: 7 }, '2026-02-01'), 'INV/25-26/007');
  assert.equal(fyLabel('2026-04-01'), '26-27');
});
test('date and time helpers', () => {
  assert.equal(diffDays(addDays('2026-10-08', -3), '2026-10-08'), -3);
  assert.equal(fmtT(14.5), '2:30 pm'); assert.equal(hm(0.75), '45 min'); assert.equal(hm(1.5), '1h 30m');
  assert.equal(inr(377600), '₹3,77,600');
});
