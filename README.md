# Lossy Counting Sketch

A single-class TypeScript-free JavaScript (ESM) implementation of the Lossy Counting algorithm for finding frequent items in an unbounded stream with bounded memory and a deterministic error bound.

## Usage

```js
import { LossyCounting } from "lossy-counting-sketch";

const lc = new LossyCounting({ support: 0.05, error: 0.01 });

const someStream = ["a", "b", "a", "c", "a", "b", "a"];
for (const item of someStream) {
  lc.add(item);
}

for (const { item, freq } of lc.heavy()) {
  console.log(item, freq, "±", lc.maxError());
}
```

Exports exactly one name: `LossyCounting` (a class).

Constructor options:
- `support` (φ, default 0.01): items whose estimated frequency is at least `support * N` are returned by `heavy()`.
- `error` (ε, default `support / 2`): error bound. Must satisfy `0 < error <= support`.

Public methods and properties:
- `add(item)` — observe one item.
- `addAll(iterable)` — observe many items.
- `frequency(item)` — estimated frequency of an item (an over-estimate by at most `maxError()`).
- `heavy()` — array of `{ item, freq }` for items whose estimated frequency meets the support threshold.
- `maxError()` — `error * total`, the worst-case over-estimate for any `frequency()` result.
- `prune()` — force a bucket rollover (normally called automatically by `add`).
- `support`, `error`, `total`, `bucketIndex`, `bucketCount`, `bucketWidth`, `entries` — observable state.

## Why this exists

You have a stream too large to hold a counter per distinct item, and you need the items whose true frequency exceeds some fraction of the stream. Exact counting is O(distinct items) in space; Lossy Counting drops counters for items that cannot yet be frequent, keeping space to O((1/ε)·log(1/ε)) entries while guaranteeing that every true heavy hitter is reported and that no reported frequency exceeds the true frequency by more than ε·N.

The trade-off is a known over-estimate. `frequency(x)` is never below the true count and never more than `maxError()` above it. Callers who need a hard lower bound subtract `maxError()` themselves and clamp at zero.

## Awkward edge

Pruning happens at fixed bucket boundaries (`bucketWidth = ceil(1/ε)` items). An item that appears just under the support threshold for a long stream will oscillate in and out of `heavy()` as buckets roll over; this is correct under the algorithm's guarantee, but it means `heavy()` is a snapshot, not a stable set. If you need stable reporting, track the returned items across calls and keep the maximum observed `freq`.

Keys use JavaScript Map equality (SameValueZero): `123` and `"123"` are distinct items. There is no type coercion; if your stream mixes representations of the same logical item, normalise before calling `add`.
