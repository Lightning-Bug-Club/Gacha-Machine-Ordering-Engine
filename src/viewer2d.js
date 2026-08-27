/**
 * viewer2d.js — loads the finalized SVG artwork and wires part selection + live recoloring.
 *
 * Phase 1: 2D orthographic viewer.
 * Phase 2: Replace this file with viewer3d.js (Three.js). All other modules
 *          (state, palette, parts, pdf) remain unchanged.
 */

import { subscribe, setSelectedPart, getState } from './state.js';

const LAYER_ID_MAP = {
  'Bottom_Chamber':               'bottom-chamber',
  'Bottom_Plate__x26__Mouth':     'bottom-plate-mouth',
  'Coin_Mech._Back_Plate':        'coin-mech-back-plate',
  'Coin_Mech._Gear':              'coin-mech-gear',
  'Coin':                         'coin',
  'Coin_Mech._Front_Plate':       'coin-mech-front-plate',
  'Knob':                         'knob',
  'Top_Chamber_x5F_Outside':      'top-chamber',
  'Main_Gear':                    'main-gear',
  'Hole_Blocker':                 'hole-blocker',
  'Mid-Plate':                    'mid-plate',
  'Lid_Lock':                     'lid-lock',
  'Back_Cover':                   'back-cover',
  'Rear_Lock_Knob':               'rear-lock-knob',
  'Lid':                          'lid',
  'Window_Overlay':               'window',
};

const FIXED_LAYERS = {
  'Top_Chamber_x5F_Inside': null, // filled dynamically: VIEWER_BG on screen, #FFFFFF in PDF
  'Top_Chamber_x5F_Inside_x5F_Back': null,
  'Black': '#565656',
};

const VIEW_PATHS = {
  front: './assets/machine-front.svg',
  side: './assets/machine-side.svg',
  back: './assets/machine-back.svg',
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.2;
const DRAG_THRESHOLD_PX = 4;
const DEFAULT_WINDOW_COLOR_ID = 'basic-pla-jade-white';
const SHAPE_SELECTOR = 'path, polygon, polyline, rect, circle, ellipse, line';

/** Background color of the viewer stage — used to fill Top_Chamber_x5F_Inside so it looks see-through. */
export const VIEWER_BG = '#b7b7b7';

let _svgRoot = null;
let _containerEl = null;
let _currentView = 'front';
let _unsubscribe = null;
let _defaultViewBox = null;
let _sessionViewBox = null;
let _dragState = null;
// Set to true briefly after endDrag fires a part-selection, to suppress the
// redundant click event that may also fire from pointer-capture release.
let _suppressNextClick = false;

export async function initViewer(containerEl, viewName = 'front') {
  _containerEl = containerEl;
  if (!_unsubscribe) {
    _unsubscribe = subscribe(_applyState);
  }
  return setCurrentView(viewName);
}

export async function setCurrentView(viewName) {
  const nextView = VIEW_PATHS[viewName] ? viewName : 'front';
  if (!_containerEl) throw new Error('Viewer container is not initialized.');

  const svgEl = await _loadViewSVG(nextView);
  _normalizeLayers(svgEl);

  _containerEl.innerHTML = '';
  _containerEl.appendChild(svgEl);

  _svgRoot = svgEl;
  _currentView = nextView;
  _defaultViewBox = _readViewBox(svgEl);
  _applyViewBox(svgEl, _sessionViewBox || _defaultViewBox);

  _wireInteractiveViewport(svgEl);
  _wirePartSelection(svgEl);

  if (nextView === 'side') {
    await _fitWindowOverlay(svgEl);
  }

  _applyState(getState());
  return svgEl;
}

export async function createPreviewSVG(viewName, state = getState()) {
  const nextView = VIEW_PATHS[viewName] ? viewName : 'front';
  const svgEl = await _loadViewSVG(nextView);
  _normalizeLayers(svgEl);

  const holder = document.createElement('div');
  holder.style.position = 'absolute';
  holder.style.left = '-99999px';
  holder.style.top = '0';
  holder.style.width = '1224px';
  holder.style.height = '792px';
  holder.style.overflow = 'hidden';
  holder.style.pointerEvents = 'none';
  holder.setAttribute('aria-hidden', 'true');

  document.body.appendChild(holder);
  holder.appendChild(svgEl);

  try {
    const viewBox = _readViewBox(svgEl);
    svgEl.setAttribute('width', String(viewBox.width));
    svgEl.setAttribute('height', String(viewBox.height));
    svgEl.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);

    if (nextView === 'side') {
      await _fitWindowOverlay(svgEl);
    }

    // isPDF=true: render Top_Chamber_Inside as white so it looks like an opening on white page
    _applyStateToSVG(svgEl, { ...state, selectedPartId: null }, nextView, true);
    return svgEl;
  } finally {
    holder.remove();
  }
}

export function zoomIn() {
  if (!_svgRoot || !_defaultViewBox) return;
  _zoomAboutSvgPoint(_svgRoot, 1 / ZOOM_STEP, 0.5, 0.5);
}

export function zoomOut() {
  if (!_svgRoot || !_defaultViewBox) return;
  _zoomAboutSvgPoint(_svgRoot, ZOOM_STEP, 0.5, 0.5);
}

export function resetViewTransform() {
  if (!_svgRoot || !_defaultViewBox) return;
  _applyViewBox(_svgRoot, _defaultViewBox);
}

function _normalizeLayers(svgEl) {
  let windowOverlayEl = null;

  svgEl.querySelectorAll(':scope > g[id]').forEach(g => {
    const rawId = g.getAttribute('id');
    if (LAYER_ID_MAP[rawId]) {
      g.setAttribute('data-part', LAYER_ID_MAP[rawId]);
      if (rawId === 'Window_Overlay') windowOverlayEl = g;
    } else if (Object.prototype.hasOwnProperty.call(FIXED_LAYERS, rawId)) {
      g.setAttribute('data-fixed-layer', rawId);
    }
  });

  if (windowOverlayEl && svgEl.lastElementChild !== windowOverlayEl) {
    svgEl.appendChild(windowOverlayEl);
  }
}

function _wirePartSelection(svgEl) {
  svgEl.querySelectorAll('[data-part]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', e => {
      if (_suppressNextClick) {
        _suppressNextClick = false;
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      setSelectedPart(el.getAttribute('data-part'));
    });
  });
}

function _wireInteractiveViewport(svgEl) {
  svgEl.style.touchAction = 'none';

  svgEl.addEventListener('wheel', e => {
    if (!_defaultViewBox) return;
    e.preventDefault();

    const current = _readViewBox(svgEl);
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const ratioX = (e.clientX - rect.left) / rect.width;
    const ratioY = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const targetWidth = current.width * factor;

    _zoomTo(svgEl, targetWidth, ratioX, ratioY);
  }, { passive: false });

  svgEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Record the deepest [data-part] element under the pointer at mousedown time
    // so we can fire part selection on pointerup if no drag occurred.
    const partEl = e.target.closest('[data-part]');

    _dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startViewBox: _readViewBox(svgEl),
      moved: false,
      targetPartEl: partEl || null,
    };

    // Only capture pointer and show drag cursor when zoomed in
    if (_isZoomedIn(svgEl)) {
      svgEl.setPointerCapture(e.pointerId);
      svgEl.classList.add('is-panning');
    }
  });

  svgEl.addEventListener('pointermove', e => {
    if (!_dragState || e.pointerId !== _dragState.pointerId || !_defaultViewBox) return;
    if (!_isZoomedIn(svgEl)) return; // only pan when zoomed in

    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dx = e.clientX - _dragState.startX;
    const dy = e.clientY - _dragState.startY;
    if (!_dragState.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      _dragState.moved = true;
    }

    if (_dragState.moved) {
      const scaleX = _dragState.startViewBox.width / rect.width;
      const scaleY = _dragState.startViewBox.height / rect.height;
      _applyViewBox(svgEl, {
        x: _dragState.startViewBox.x - dx * scaleX,
        y: _dragState.startViewBox.y - dy * scaleY,
        width: _dragState.startViewBox.width,
        height: _dragState.startViewBox.height,
      });
    }
  });

  const endDrag = e => {
    if (!_dragState || (_dragState.pointerId !== null && e.pointerId !== _dragState.pointerId)) return;
    if (svgEl.hasPointerCapture?.(e.pointerId)) {
      svgEl.releasePointerCapture(e.pointerId);
    }

    // When zoomed in, pointer capture is active, which prevents click events
    // from reaching child [data-part] elements. Handle part selection here instead.
    // At normal zoom, click events fire normally on child elements, so skip here.
    if (!_dragState.moved && _dragState.targetPartEl && _isZoomedIn(svgEl)) {
      _suppressNextClick = true; // suppress the redundant click that may still fire
      setSelectedPart(_dragState.targetPartEl.getAttribute('data-part'));
    } else if (_dragState.moved) {
      _suppressNextClick = true; // suppress click after a real drag/pan
    }

    svgEl.classList.remove('is-panning');
    _dragState = null;
  };

  svgEl.addEventListener('pointerup', endDrag);
  svgEl.addEventListener('pointercancel', endDrag);
  svgEl.addEventListener('lostpointercapture', () => {
    svgEl.classList.remove('is-panning');
    _dragState = null;
  });
}

async function _fitWindowOverlay(svgEl) {
  await _waitForLayout();

  const overlayGroup = svgEl.querySelector('[data-part="window"]');
  if (!overlayGroup) return;

  const overlayRect = overlayGroup.querySelector('rect');
  if (!overlayRect) return;

  const box = _getTopChamberInsideBox(svgEl) || _getLegacyWindowBox(svgEl) || {
    x: 476,
    y: 155,
    width: 230,
    height: 240,
  };

  overlayRect.setAttribute('x', box.x);
  overlayRect.setAttribute('y', box.y);
  overlayRect.setAttribute('width', box.width);
  overlayRect.setAttribute('height', box.height);
  overlayRect.setAttribute('rx', '8');
  overlayRect.setAttribute('ry', '8');
}

function _getTopChamberInsideBox(svgEl) {
  const insideEl = svgEl.querySelector('[data-fixed-layer="Top_Chamber_x5F_Inside"], #Top_Chamber_x5F_Inside');
  if (!insideEl) return null;

  try {
    const bbox = insideEl.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    }
  } catch (_) {
    return null;
  }

  return null;
}

function _getLegacyWindowBox(svgEl) {
  const targetParts = ['hole-blocker', 'main-gear', 'mid-plate'];
  let union = null;

  targetParts.forEach(partId => {
    const el = svgEl.querySelector(`[data-part="${partId}"]`);
    if (!el) return;
    try {
      const bb = el.getBBox();
      if (!bb.width && !bb.height) return;
      if (!union) {
        union = { x: bb.x, y: bb.y, x2: bb.x + bb.width, y2: bb.y + bb.height };
      } else {
        union.x = Math.min(union.x, bb.x);
        union.y = Math.min(union.y, bb.y);
        union.x2 = Math.max(union.x2, bb.x + bb.width);
        union.y2 = Math.max(union.y2, bb.y + bb.height);
      }
    } catch (_) {
      // Ignore missing/non-rendered elements and continue to the fallback.
    }
  });

  if (!union) return null;

  return {
    x: union.x - 6,
    y: union.y - 6,
    width: union.x2 - union.x + 12,
    height: union.y2 - union.y + 12,
  };
}

function _applyState(state) {
  _applyStateToSVG(_svgRoot, state, _currentView, false);
}

function _applyStateToSVG(svgRoot, state, viewName, isPDF = false) {
  if (!svgRoot) return;

  const topChamberHex = state.selections['top-chamber']
    ? _resolveHex(state.selections['top-chamber'])
    : null;

  svgRoot.querySelectorAll('[data-part]').forEach(el => {
    const partId = el.getAttribute('data-part');

    if (partId === 'window') {
      const show = viewName === 'side' && state.windowsMaterial === 'printed';
      el.style.display = show ? '' : 'none';
      if (show) {
        el.setAttribute('opacity', '0.8');
        _setFillRecursive(el, _resolveHex(state.selections.window || DEFAULT_WINDOW_COLOR_ID));
        _setStrokeStateRecursive(el, state.selectedPartId === partId);
      }
      return;
    }

    if (state.selections[partId]) {
      _setFillRecursive(el, _resolveHex(state.selections[partId]));
    }

    _setStrokeStateRecursive(el, state.selectedPartId === partId);
  });

  svgRoot.querySelectorAll('[data-fixed-layer]').forEach(el => {
    const rawId = el.getAttribute('data-fixed-layer');
    if (rawId === 'Top_Chamber_x5F_Inside') {
      // On screen: match viewer stage background so it looks like an opening.
      // In PDF: use white so it reads as an opening on the white page.
      _setFillRecursive(el, isPDF ? '#FFFFFF' : VIEWER_BG);
    } else if (rawId === 'Top_Chamber_x5F_Inside_x5F_Back') {
      if (topChamberHex) _setFillRecursive(el, topChamberHex);
    } else if (rawId === 'Black') {
      _setFillRecursive(el, '#565656');
    }
  });
}

function _setFillRecursive(el, hex) {
  if (el.tagName === 'g' || el.tagName === 'G') {
    el.querySelectorAll('path, polygon, polyline, rect, circle, ellipse').forEach(shape => {
      shape.style.fill = hex;
    });
  } else {
    el.style.fill = hex;
  }
}

function _setStrokeStateRecursive(el, isSelected) {
  const shapes = el.matches?.(SHAPE_SELECTOR) ? [el] : Array.from(el.querySelectorAll(SHAPE_SELECTOR));
  shapes.forEach(shape => {
    if (!shape.dataset.originalStroke) {
      const computed = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(shape)
        : null;
      shape.dataset.originalStroke = shape.getAttribute('stroke') || computed?.stroke || '';
      shape.dataset.originalStrokeWidth = shape.getAttribute('stroke-width') || computed?.strokeWidth || '';
    }

    const originalStroke = shape.dataset.originalStroke;
    const originalWidth = parseFloat(shape.dataset.originalStrokeWidth || '0');
    const fallbackStroke = originalStroke && originalStroke !== 'none' ? originalStroke : '#000000';
    const fallbackWidth = originalWidth > 0 ? originalWidth : 1.5;

    shape.style.vectorEffect = 'non-scaling-stroke';
    shape.style.paintOrder = 'stroke fill markers';
    shape.style.stroke = isSelected ? '#FFD700' : fallbackStroke;
    shape.style.strokeWidth = String(isSelected ? Math.max(3, fallbackWidth * 1.75) : fallbackWidth);
  });

  if (isSelected) {
    el.setAttribute('filter', 'drop-shadow(0 0 6px rgba(255,215,0,0.8))');
  } else {
    el.removeAttribute('filter');
  }
}

function _resolveHex(colorId) {
  if (/^#[0-9a-fA-F]{3,6}$/.test(colorId)) return colorId;
  if (window.__paletteMap) {
    const entry = window.__paletteMap[colorId];
    if (entry) return entry.hex;
  }
  return colorId;
}

async function _loadViewSVG(viewName) {
  const res = await fetch(VIEW_PATHS[viewName]);
  if (!res.ok) throw new Error(`Failed to load ${viewName} SVG: ${res.status}`);

  const svgText = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error(`Invalid ${viewName} SVG: no <svg> root element found.`);

  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');
  return svgEl;
}

function _zoomAboutSvgPoint(svgEl, factor, ratioX, ratioY) {
  const current = _readViewBox(svgEl);
  const focusX = current.x + current.width * ratioX;
  const focusY = current.y + current.height * ratioY;
  _zoomTo(svgEl, current.width * factor, ratioX, ratioY, focusX, focusY);
}

function _zoomTo(svgEl, targetWidth, ratioX, ratioY, focusX = null, focusY = null) {
  if (!_defaultViewBox) return;

  const boundedWidth = Math.min(
    _defaultViewBox.width / MIN_ZOOM,
    Math.max(_defaultViewBox.width / MAX_ZOOM, targetWidth)
  );
  const boundedHeight = boundedWidth * (_defaultViewBox.height / _defaultViewBox.width);

  const current = _readViewBox(svgEl);
  const anchorX = focusX ?? (current.x + current.width * ratioX);
  const anchorY = focusY ?? (current.y + current.height * ratioY);

  _applyViewBox(svgEl, {
    x: anchorX - boundedWidth * ratioX,
    y: anchorY - boundedHeight * ratioY,
    width: boundedWidth,
    height: boundedHeight,
  });
}

function _applyViewBox(svgEl, nextViewBox) {
  if (!_defaultViewBox) {
    _defaultViewBox = _readViewBox(svgEl);
  }

  const clamped = _clampViewBox(nextViewBox, _defaultViewBox);
  svgEl.setAttribute('viewBox', `${clamped.x} ${clamped.y} ${clamped.width} ${clamped.height}`);
  _sessionViewBox = { ...clamped };
}

function _clampViewBox(box, bounds) {
  const width = Math.min(bounds.width / MIN_ZOOM, Math.max(bounds.width / MAX_ZOOM, box.width));
  const height = width * (bounds.height / bounds.width);

  let x = box.x;
  let y = box.y;

  if (width >= bounds.width) {
    x = bounds.x - (width - bounds.width) / 2;
  } else {
    x = Math.min(bounds.x + bounds.width - width, Math.max(bounds.x, x));
  }

  if (height >= bounds.height) {
    y = bounds.y - (height - bounds.height) / 2;
  } else {
    y = Math.min(bounds.y + bounds.height - height, Math.max(bounds.y, y));
  }

  return { x, y, width, height };
}

function _readViewBox(svgEl) {
  const raw = svgEl.getAttribute('viewBox');
  if (raw) {
    const [x, y, width, height] = raw.split(/\s+/).map(Number);
    return { x, y, width, height };
  }

  const baseVal = svgEl.viewBox?.baseVal;
  return {
    x: baseVal?.x || 0,
    y: baseVal?.y || 0,
    width: baseVal?.width || 1224,
    height: baseVal?.height || 792,
  };
}

function _isZoomedIn(svgEl) {
  const current = _readViewBox(svgEl);
  return current.width < (_defaultViewBox?.width || current.width) - 0.5;
}

function _waitForLayout() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function recolorPart(partId, hex) {
  if (!_svgRoot) return;
  _svgRoot.querySelectorAll(`[data-part="${partId}"]`).forEach(el => {
    _setFillRecursive(el, hex);
  });
}

export function getSVGElement() {
  return _svgRoot;
}

export function getCurrentView() {
  return _currentView;
}
