/**
 * Core implementation of the Lossy Counting algorithm for finding frequent items
 * in a stream.
 *
 * DESIGN DECISIONS (read before extending):
 *
 * 1. "Estimated frequency" is reported as the stored bucket count. The original
 *    Lossy Counting paper guarantees this is an over-estimate by at most ε·N for
 *    an item that is truly frequent. That is the documented contract. We do not
 *    subtract the error bound, because callers checking frequency thresholds
 *    ("keep items with estimated freq ≥ 100") get correct results; only callers
 *    who need a lower bound need to know about the over-estimate, and for that
 *    we expose maxError() so they can compute freq − maxError themselves.
 *
 * 2. Counts are stored in a Map keyed by item. We do NOT deduplicate string
 *    keys against the possibility of "equal" items of different types — JavaScript
 *    Maps use SameValueZero equality, so 123 (number) and "123" (string) are
 *    distinct keys. This is deliberate; coercing would surprise callers who feed
 *    mixed-type streams.
 *
 * 3. The bucket width is ⌈1/ε⌉. When ε does not divide 1 evenly we round up so
 *    the over-estimate bound holds; using ⌊1/ε⌋ would tighten the error only on
 *    a fraction of streams and complicate the proof for no real gain.
 */

/**
 * Approximate frequent-items sketch over an item stream.
 *
 * Guarantees (for stream length N and support error ε):
 *   - An item with true frequency ≥ (φ + ε)·N is reported with estimated
 *     frequency ≥ φ·N.
 *   - An item with true frequency < φ·N may be reported, but its estimated
 *     frequency does not exceed its true frequency by more than ε·N.
 *   - Space is O((1/ε) · log(1/ε)) entries.
 */
export class LossyCounting {
  /**
   * @param {object} [opts]
   * @param {number} [opts.support] Support threshold φ in (0, 1). Items whose
   *   estimated frequency is at least `support * N` are returned by `heavy()`.
   *   Default 0.01 (1%).
   * @param {number} [opts.error] Error bound ε in (0, support]. Controls both
   *   the memory footprint and the over-estimate magnitude. Default
   *   `support / 2`, which gives a comfortable accuracy margin without exploding
   *   the bucket count for small support values.
   */
  constructor({ support = 0.01, error = support / 2 } = {}) {
    if (!(support > 0) || !(support < 1)) {
      throw new RangeError(`support must satisfy 0 < support < 1, got ${support}`);
    }
    if (!(error > 0) || !(error <= support)) {
      throw new RangeError(
        `error must satisfy 0 < error <= support, got ${error} (support=${support})`
      );
    }

    /**
     * Support threshold φ.
     * @type {number}
     * @readonly
     */
    this.support = support;

    /**
     * Error bound ε.
     * @type {number}
     * @readonly
     */
    this.error = error;

    /**
     * Number of items observed since the most recent bucket boundary.
     * Reset to 0 each time a bucket is processed.
     * @type {number}
     */
    this.bucketCount = 0;

    /**
     * Index of the current bucket. Incremented when a bucket is processed.
     * The width of each bucket is Math.ceil(1 / this.error).
     * @type {number}
     */
    this.bucketIndex = 0;

    /**
     * Number of items processed total. Used by heavy() and maxError().
     * @type {number}
     */
    this.total = 0;

    /**
     * Stored entries. Keyed by item; value is { freq: number, bucket: number }.
     * Entries are pruned to the current bucket index on bucket rollover so
     * that any item whose freq + (current bucket − entry.bucket) ≤ current
     * bucket index is dropped.
     * @type {Map<*, {freq: number, bucket: number}>}
     */
    this.entries = new Map();
  }

  /**
   * Width of a single bucket, in items.
   * @returns {number}
   */
  get bucketWidth() {
    // Memoized on a property so callers reading it per-item pay one ceil per read.
    // Math.ceil(1/this.error) — rounding up keeps the over-estimate bound valid.
    return Math.ceil(1 / this.error);
  }

  /**
   * Observe one item. Updates stored counts and triggers pruning when the
   * current bucket fills.
   *
   * @param {*} item Anything usable as a Map key (SameValueZero). Primitives
   *   and stable object references both work; newly-allocated objects each
   *   count as their own key, which is rarely what you want.
   * @returns {void}
   */
  add(item) {
    const existing = this.entries.get(item);
    if (existing) {
      existing.freq += 1;
    } else {
      // New entries are stamped with the current bucket index so that pruning
      // sees them as having survived at most `current - bucket` buckets so far.
      this.entries.set(item, { freq: 1, bucket: this.bucketIndex });
    }

    this.total += 1;
    this.bucketCount += 1;

    if (this.bucketCount >= this.bucketWidth) {
      this.prune();
    }
  }

  /**
   * Observe many items. Equivalent to calling add() in a loop but avoids the
   * per-item method call overhead when ingesting large pre-built arrays.
   *
   * @param {Iterable<*>} items
   * @returns {void}
   */
  addAll(items) {
    for (const item of items) {
      this.add(item);
    }
  }

  /**
   * Process the current bucket: drop any entry whose effective count
   * (freq + entry.bucket − currentBucket) is at most the current bucket index.
   * After pruning, advance the bucket and reset the per-bucket counter.
   *
   * Exposed as a method (rather than inlined in add()) only for tests that want
   * to observe state at the exact bucket boundary.
   *
   * @returns {void}
   */
  prune() {
    const current = this.bucketIndex;
    for (const [key, entry] of this.entries) {
      // An item's guaranteed-minimum true frequency is
      //   freq − (current − entry.bucket).
      // If that minimum is ≤ current (the number of buckets seen so far),
      // the item cannot yet be frequent and is safe to drop.
      if (entry.freq + entry.bucket - current <= current) {
        this.entries.delete(key);
      }
    }
    this.bucketIndex += 1;
    this.bucketCount = 0;
  }

  /**
   * Estimated frequency of `item` in the stream observed so far.
   *
   * The returned value is an over-estimate: the true frequency is at least
   * `freq − maxError()` and at most `freq`. Callers who need a lower bound
   * should subtract maxError() themselves.
   *
   * @param {*} item
   * @returns {number} Non-negative integer. 0 if the item has never been seen
   *   (or was seen and subsequently pruned).
   */
  frequency(item) {
    const entry = this.entries.get(item);
    return entry ? entry.freq : 0;
  }

  /**
   * Upper bound on the over-estimate for any item's reported frequency.
   *
   * Equals ε·N where N is the total number of items observed so far.
   * For an item with estimated frequency `f`, the true frequency is in
   * [f − maxError(), f]. Note the lower bound may be negative; clamp to 0
   * if a non-negative bound is required.
   *
   * @returns {number}
   */
  maxError() {
    return this.error * this.total;
  }

  /**
   * All items whose estimated frequency is at least `support * N`.
   *
   * Because estimated frequencies over-estimate, this set is a superset of
   * the true heavy hitters (those with true frequency ≥ support * N). The
   * number of false positives is bounded; see maxError() to tighten.
   *
   * @returns {Array<{item: *, freq: number}>} Entries in insertion order of
   *   the underlying Map, which is the order items were first inserted.
   *   Callers needing a different order should sort the result themselves.
   */
  heavy() {
    const threshold = this.support * this.total;
    const out = [];
    for (const [item, entry] of this.entries) {
      if (entry.freq >= threshold) {
        out.push({ item, freq: entry.freq });
      }
    }
    return out;
  }
}
