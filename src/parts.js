/**
 * parts.js — loads the machine's colorable parts definitions.
 *
 * Each part: { id, label, defaultColorId }
 * The id must match the data-part attribute on the SVG elements.
 */

let _parts = null;

/**
 * Load parts from the JSON file.
 * Returns a promise that resolves to the parts array.
 */
export async function loadParts() {
  if (_parts) return _parts;
  const res = await fetch('./data/parts.json');
  if (!res.ok) throw new Error(`Failed to load parts: ${res.status}`);
  _parts = await res.json();
  return _parts;
}

/**
 * Return the parts list (must call loadParts() first).
 */
export function getParts() {
  if (!_parts) throw new Error('Parts not loaded. Call loadParts() first.');
  return _parts;
}

/**
 * Look up a single part by id. Returns undefined if not found.
 */
export function getPartById(id) {
  return getParts().find(p => p.id === id);
}
