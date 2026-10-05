import { test } from "node:test";
import assert from "node:assert/strict";
import { LossyCounting } from "../src/core.js";

// Helper that accepts numeric tolerances without using float ===.
function approxEqual(actual, expected, tol = 1e-9) {
  return Math.abs(actual - expected) <= tol;
}

test("constructor rejects invalid support", () => {
  assert.throws(() => new LossyCounting({ support: 0 }), RangeError);
  assert.throws(() => new LossyCounting({ support: 1 }), RangeError);
  assert.throws(() => new LossyCounting({ support: -0.1 }), RangeError);
  assert.throws(() => new LossyCounting({ support: 1.5 }), RangeError);
});

test("constructor rejects invalid error (must be ≤ support, > 0)", () => {
  assert.throws(() => new LossyCounting({ support: 0.1, error: 0 }), RangeError);
  assert.throws(() => new LossyCounting({ support: 0.1, error: 0.2 }), RangeError);
  assert.throws(() => new LossyCounting({ support: 0.1, error: -0.01 }), RangeError);
});

test("constructor accepts error equal to support", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  assert.equal(lc.support, 0.1);
  assert.equal(lc.error, 0.1);
});

test("default error is half of support", () => {
  const lc = new LossyCounting({ support: 0.02 });
  assert.equal(lc.error, 0.01);
});

test("bucketWidth is ceil(1/error)", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  assert.equal(lc.bucketWidth, 10);

  const lc2 = new LossyCounting({ support: 0.05, error: 0.03 });
  // 1/0.03 = 33.33..., ceil = 34
  assert.equal(lc2.bucketWidth, 34);
});

test("frequency of unseen item is 0", () => {
  const lc = new LossyCounting();
  assert.equal(lc.frequency("absent"), 0);
});

test("add tracks frequency exactly before any pruning", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  for (let i = 0; i < 5; i++) lc.add("a");
  assert.equal(lc.frequency("a"), 5);
  assert.equal(lc.total, 5);
  assert.equal(lc.bucketIndex, 0);
});

test("prune is triggered exactly at bucketWidth", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  // bucketWidth = 10
  for (let i = 0; i < 10; i++) lc.add("a");
  // After 10 adds, prune has run once: bucketIndex 0 -> 1.
  assert.equal(lc.bucketIndex, 1);
  assert.equal(lc.bucketCount, 0);
  // 'a' has freq 10, entry.bucket was 0, current is now 1.
  // Effective: 10 + 0 - 1 = 9 > 1, so 'a' survives.
  assert.equal(lc.frequency("a"), 10);
});

test("prune drops items whose effective count falls at or below bucket index", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  // 2 rare items + 8 frequent items per bucket of 10.
  lc.add("rare1");
  lc.add("rare2");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  lc.add("a");
  // Bucket boundary hit. rare1/rare2 have freq 1, entry.bucket 0, current 0
  // at prune time: 1 + 0 - 0 = 1 <= 0? No. They survive this round.
  assert.equal(lc.frequency("rare1"), 1);
  assert.equal(lc.bucketIndex, 1);

  // Fill another bucket with only 'a' so rare1/rare2 do not gain counts.
  for (let i = 0; i < 10; i++) lc.add("a");
  // Now current was 1 at prune time. rare1: 1 + 0 - 1 = 0 <= 1? Yes. Dropped.
  assert.equal(lc.frequency("rare1"), 0);
  assert.equal(lc.frequency("rare2"), 0);
  // 'a' appeared 8 times in the first bucket and 10 times in the second = 18.
  assert.equal(lc.frequency("a"), 18);
});

test("addAll matches repeated add", () => {
  const a = new LossyCounting({ support: 0.1, error: 0.1 });
  const b = new LossyCounting({ support: 0.1, error: 0.1 });
  const items = [];
  for (let i = 0; i < 25; i++) items.push(i % 3);
  for (const x of items) a.add(x);
  b.addAll(items);
  assert.equal(a.frequency(0), b.frequency(0));
  assert.equal(a.frequency(1), b.frequency(1));
  assert.equal(a.frequency(2), b.frequency(2));
  assert.equal(a.total, b.total);
  assert.equal(a.bucketIndex, b.bucketIndex);
});

test("frequent item survives many buckets", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.1 });
  // 200 items: 'a' appears 100 times (50%), interleaved with distinct noise.
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) lc.add("a");
    else lc.add(`noise-${i}`);
  }
  assert.equal(lc.total, 200);
  // 'a' may be over-counted by at most error * total = 0.1 * 200 = 20.
  const fa = lc.frequency("a");
  assert.ok(fa >= 100, `freq ${fa} should be >= true 100`);
  assert.ok(fa <= 120, `freq ${fa} should be <= 100 + maxError 20`);
});

test("heavy returns items above support threshold", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.05 });
  for (let i = 0; i < 100; i++) lc.add("a");
  for (let i = 0; i < 10; i++) lc.add("b");
  // threshold = 0.1 * 110 = 11. 'a' (freq 100) qualifies; 'b' (freq 10) does not.
  const h = lc.heavy();
  assert.equal(h.length, 1);
  assert.equal(h[0].item, "a");
  assert.equal(h[0].freq, 100);
});

test("maxError equals error * total", () => {
  const lc = new LossyCounting({ support: 0.1, error: 0.05 });
  for (let i = 0; i < 42; i++) lc.add(i);
  assert.ok(approxEqual(lc.maxError(), 0.05 * 42));
});

test("maxError is 0 before any items", () => {
  const lc = new LossyCounting();
  assert.equal(lc.maxError(), 0);
  assert.equal(lc.total, 0);
});

test("string and number keys are distinct (no coercion)", () => {
  const lc = new LossyCounting({ support: 0.5, error: 0.5 });
  lc.add(123);
  lc.add("123");
  lc.add(123);
  assert.equal(lc.frequency(123), 2);
  assert.equal(lc.frequency("123"), 1);
});
