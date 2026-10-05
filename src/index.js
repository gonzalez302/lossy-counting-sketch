/**
 * Lossy Counting Sketch — public entry point.
 *
 * Re-exports the single implementation class so callers depend on the package
 * root, not on internal module paths. Keeps the public surface to one name.
 *
 * @module lossy-counting-sketch
 */

export { LossyCounting } from "./core.js";
