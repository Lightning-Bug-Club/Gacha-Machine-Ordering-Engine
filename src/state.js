/**
 * state.js — configuration state management and URL serialization.
 *
 * State shape:
 *   {
 *     selections:         { [partId]: colorId },  // part→color assignments (may include defaults)
 *     explicitSelections:  { [partId]: true },     // parts actually chosen by the user (or restored
 *                                                   // from a shared URL), used to keep default
 *                                                   // placeholder colors out of cost estimates
 *     selectedPartId:  string | null,           // currently highlighted part
 *     windowsMaterial: 'printed' | 'acrylic',   // windows material choice
 *     includeBalls:    boolean,                  // whether to add 50 clear balls
 *   }
 */

const _listeners = [];

let _state = {
  selections: {},
  explicitSelections: {},
  selectedPartId: null,
  windowsMaterial: 'printed', // default: 3D printed windows
  includeBalls: false,
};

/** Return a shallow copy of the current state. */
export function getState() {
  return {
    ..._state,
    selections: { ..._state.selections },
    explicitSelections: { ..._state.explicitSelections },
  };
}

/** Return only the selections map { partId: colorId }. */
export function getSelections() {
  return { ..._state.selections };
}

/**
 * Return only the selections that were explicitly chosen by the user (or
 * restored from a shared URL) — i.e. excluding parts that are only showing
 * their default/placeholder color. Used for cost estimation so unselected
 * parts never contribute to the estimate.
 */
export function getExplicitSelections() {
  const explicit = {};
  Object.keys(_state.explicitSelections).forEach(partId => {
    if (_state.selections[partId]) explicit[partId] = _state.selections[partId];
  });
  return explicit;
}

/**
 * Set the color for a part and notify listeners.
 * Pass `{ explicit: false }` when filling in a default/placeholder color so
 * it is not treated as a user selection for cost estimation purposes.
 */
export function setPartColor(partId, colorId, { explicit = true } = {}) {
  _state = {
    ..._state,
    selections: { ..._state.selections, [partId]: colorId },
    explicitSelections: explicit
      ? { ..._state.explicitSelections, [partId]: true }
      : _state.explicitSelections,
  };
  _notify();
}

/** Reset all part color selections to their default color (e.g. white for all). */
export function resetSelectionsToDefault(parts) {
  const defaults = {};
  const explicit = {};
  parts.forEach(part => {
    defaults[part.id] = part.defaultColorId;
    explicit[part.id] = true;
  });
  _state = { ..._state, selections: defaults, explicitSelections: explicit };
  _notify();
}

/** Set the currently selected part (for UI highlighting). */
export function setSelectedPart(partId) {
  _state = { ..._state, selectedPartId: partId };
  _notify();
}

/** Replace the entire selections map (e.g. when restoring from URL). */
export function loadSelections(selections) {
  const explicit = {};
  Object.keys(selections).forEach(partId => { explicit[partId] = true; });
  _state = { ..._state, selections: { ...selections }, explicitSelections: explicit };
  _notify();
}

/** Set the windows material choice and notify listeners. */
export function setWindowsMaterial(material) {
  if (material !== 'printed' && material !== 'acrylic') return;
  _state = { ..._state, windowsMaterial: material };
  _notify();
}

/** Set whether to include the clear balls add-on. */
export function setIncludeBalls(include) {
  _state = { ..._state, includeBalls: !!include };
  _notify();
}

/** Register a callback to be called whenever state changes. */
export function subscribe(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i !== -1) _listeners.splice(i, 1);
  };
}

function _notify() {
  const snap = getState();
  _listeners.forEach(fn => fn(snap));
}

// ─── URL encode / decode ────────────────────────────────────────────────────

/**
 * Encode the current selections + windowsMaterial + includeBalls into a URL query string.
 * Format: c=partId:colorId,...  &w=printed|acrylic  &b=true|false
 */
export function encodeStateToURL() {
  const url = new URL(window.location.href);

  const entries = Object.entries(_state.selections);
  if (entries.length > 0) {
    const encoded = entries.map(([p, c]) => `${encodeURIComponent(p)}:${encodeURIComponent(c)}`).join(',');
    url.searchParams.set('c', encoded);
  } else {
    url.searchParams.delete('c');
  }

  url.searchParams.set('w', _state.windowsMaterial);
  if (_state.includeBalls) {
    url.searchParams.set('b', 'true');
  } else {
    url.searchParams.delete('b');
  }
  return url.toString();
}

/**
 * Push the current state into the browser history (updates the address bar).
 */
export function pushStateToURL() {
  const url = encodeStateToURL();
  if (url) window.history.replaceState(null, '', url);
}

/**
 * Read selections + windowsMaterial + includeBalls from the current URL and load them.
 * Returns the loaded selections object (may be empty).
 */
export function decodeStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  // Restore color selections
  const c = params.get('c');
  const selections = {};
  if (c) {
    c.split(',').forEach(pair => {
      const idx = pair.indexOf(':');
      if (idx === -1) return;
      const partId  = decodeURIComponent(pair.slice(0, idx));
      const colorId = decodeURIComponent(pair.slice(idx + 1));
      if (partId && colorId) selections[partId] = colorId;
    });
    loadSelections(selections);
  }

  // Restore windows material
  const w = params.get('w');
  if (w === 'acrylic' || w === 'printed') {
    setWindowsMaterial(w);
  }

  // Restore include balls
  const b = params.get('b');
  if (b === 'true') {
    setIncludeBalls(true);
  }

  return selections;
}
