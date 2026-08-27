/**
 * main.js — wires together palette, parts, state, viewer2d, pricing, and UI.
 *
 * Phase 1 entry point with cost estimation & ordering integration.
 */

import { loadPalette, getColors, getColorById } from './palette.js';
import { loadParts, getParts } from './parts.js';
import {
  getState,
  setPartColor,
  setSelectedPart,
  setWindowsMaterial,
  loadSelections,
  subscribe,
  decodeStateFromURL,
  pushStateToURL,
  resetSelectionsToDefault,
  setIncludeBalls,
  getExplicitSelections,
} from './state.js';
import {
  initViewer,
  getCurrentView,
  setCurrentView,
  createPreviewSVG,
  zoomIn,
  zoomOut,
  resetViewTransform,
} from './viewer2d.js';
import { exportPDF } from './pdf.js';
import { randomizeHarmony, HARMONIES } from './harmony.js';
import { listBuilds, saveBuild, deleteBuild, upsertBuild, getMaxBuilds } from './builds.js';
import { calculateBuildCost, formatCost } from './pricing.js';

const SERIES_ORDER = [
  'Basic PLA',
  'PLA Matte',
  'PLA Silk',
  'PLA Wood',
  'PLA Translucent',
  'PLA Glow',
];

const USER_COLORS_STORAGE_KEY = 'gatagata.userColors.v1';
const USER_COLOR_SLOT_COUNT = 4;

let _userColorSlots = Array(USER_COLOR_SLOT_COUNT).fill(null);
let _activeUserColorSlot = null;
let _filamentUsage = {};

async function init() {
  // ── Load data ──────────────────────────────────────────────────────────
  const [colors, parts, filamentUsage] = await Promise.all([
    loadPalette(),
    loadParts(),
    _loadFilamentUsage(),
  ]);

  _filamentUsage = filamentUsage;

  // Expose palette map globally so viewer2d.js can resolve color ids to hex
  window.__paletteMap = {};
  colors.forEach(c => { window.__paletteMap[c.id] = c; });

  // ── Restore state from URL (before init so the viewer gets initial colors) ─
  decodeStateFromURL();

  // Apply default colors for parts that have no URL selection, for display
  // purposes only. These are marked as non-explicit so they never leak into
  // the cost estimate unless the user actually chooses them.
  const state = getState();
  parts.forEach(part => {
    if (!state.selections[part.id]) {
      setPartColor(part.id, part.defaultColorId, { explicit: false });
    }
  });

  // ── Init viewer ─────────────────────────────────────────────────────────
  const viewerEl = document.getElementById('viewer');
  await initViewer(viewerEl, 'front');
  _wireViewSelector();
  _wireZoomControls();

  // ── Build parts list sidebar ──────────────────────────────────────────────
  const partsList = document.getElementById('parts-list');
  // Exclude 'window' from the main parts list — managed separately below
  const displayParts = parts.filter(p => p.id !== 'window');
  const windowPart = parts.find(p => p.id === 'window');

  displayParts.forEach(part => {
    const li = document.createElement('li');
    li.className = 'part-item';
    li.dataset.partId = part.id;
    li.textContent = part.label;
    li.addEventListener('click', () => setSelectedPart(part.id));
    partsList.appendChild(li);
  });

  // Window row — shown only when 3D-printed windows is active
  let windowLi = null;
  if (windowPart) {
    windowLi = document.createElement('li');
    windowLi.className = 'part-item window-part-item';
    windowLi.dataset.partId = 'window';
    windowLi.textContent = windowPart.label || 'Window';
    windowLi.addEventListener('click', () => {
      if (getState().windowsMaterial === 'printed') {
        setSelectedPart('window');
      }
    });
    partsList.appendChild(windowLi);
    // Initial visibility
    windowLi.style.display = getState().windowsMaterial === 'printed' ? '' : 'none';
  }

  // ── Windows material selector ─────────────────────────────────────────────
  _wireWindowsSelector();

  // ── Build color palette grid ──────────────────────────────────────────────
  const paletteGrid = document.getElementById('palette-grid');
  _userColorSlots = _loadUserColorSlots(colors);
  _renderPaletteGroups(paletteGrid, colors, color => _assignActiveUserColorSlot(color, colors));
  _wireYourColorsTray(colors);
  _wireSavedBuilds();
  _wireCostPanel(parts);

  // ── Color name tooltip label ──────────────────────────────────────────────
  const colorNameEl = document.getElementById('color-name');
  paletteGrid.addEventListener('mouseover', e => {
    const btn = e.target.closest('.color-swatch');
    if (btn) colorNameEl.textContent = btn.title;
  });
  paletteGrid.addEventListener('mouseleave', () => {
    colorNameEl.textContent = '';
  });

  // ── Reactive UI updates ───────────────────────────────────────────────────
  subscribe(snap => {
    // Highlight selected part in sidebar
    partsList.querySelectorAll('.part-item').forEach(li => {
      li.classList.toggle('selected', li.dataset.partId === snap.selectedPartId);
    });

    // Show/hide window row based on material
    if (windowLi) {
      const show = snap.windowsMaterial === 'printed';
      windowLi.style.display = show ? '' : 'none';
      // If switching to acrylic while window is selected, deselect it
      if (!show && snap.selectedPartId === 'window') {
        setSelectedPart(null);
      }
    }

    // Show color name & swatch for selected part
    const activeColorId = snap.selectedPartId
      ? snap.selections[snap.selectedPartId]
      : null;
    const activeColor = activeColorId ? getColorById(activeColorId) : null;

    const selectedColorEl = document.getElementById('selected-color');
    if (selectedColorEl) {
      if (activeColor) {
        selectedColorEl.textContent = `${activeColor.name} — ${activeColor.hex}`;
        selectedColorEl.style.setProperty('--swatch', activeColor.hex);
      } else {
        selectedColorEl.textContent = '';
      }
    }

    // Highlight active swatch in palette
    paletteGrid.querySelectorAll('.color-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.colorId === activeColorId);
    });

    // Disable window color picking when "Clear acrylic" is selected
    const windowsPrinted = snap.windowsMaterial === 'printed';
    paletteGrid.querySelectorAll('.color-swatch').forEach(btn => {
      if (snap.selectedPartId === 'window' && !windowsPrinted) {
        btn.disabled = true;
        btn.style.opacity = '0.35';
        btn.style.cursor = 'not-allowed';
      } else {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
      }
    });

    // Update cost panel
    _updateCostPanel(snap, parts);

    // Push state to URL for shareability
    pushStateToURL();
  });

  // ── Export PDF button ─────────────────────────────────────────────────────
  document.getElementById('btn-export-pdf').addEventListener('click', async () => {
    try {
      const previewDataURLs = await _renderPreviewSet();

      await exportPDF({
        previewDataURLs,
        selections: getState().selections,
        explicitSelections: getExplicitSelections(),
        windowsMaterial: getState().windowsMaterial,
        parts: getParts(),
        colors: getColors(),
        filamentUsage: _filamentUsage,
        includeBalls: getState().includeBalls,
      });
      _showToast('PDF exported with Front, Side, and Back previews.');
    } catch (err) {
      console.error('PDF export failed:', err);
      _showToast(err.message || 'PDF export failed. Please try again.');
    }
  });

  // ── Share URL button ──────────────────────────────────────────────────────
  const btnShare = document.getElementById('btn-share');
  if (btnShare) {
    btnShare.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => _showToast('Link copied to clipboard!'));
      } else {
        prompt('Copy this link to share your config:', url);
      }
    });
  }

  // ── Reset Colors button ───────────────────────────────────────────────────
  const btnReset = document.getElementById('btn-reset-colors');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      resetSelectionsToDefault(getParts());
      setSelectedPart(null);
      _showToast('All parts reset to white.');
    });
  }

  // ── Randomize button ──────────────────────────────────────────────────────
  const btnRandomize = document.getElementById('btn-randomize');
  const harmonySelect = document.getElementById('harmony-select');
  if (btnRandomize && harmonySelect) {
    btnRandomize.addEventListener('click', () => {
      const harmony = harmonySelect.value;
      const palette = getColors();
      const seen = new Set();
      const userColors = _userColorSlots
        .filter(Boolean)
        .map(id => palette.find(color => color.id === id))
        .filter(Boolean)
        .filter(color => {
          if (seen.has(color.id)) return false;
          seen.add(color.id);
          return true;
        });
      const randomizeSet = _buildRandomizeColorSet(harmony, palette, userColors);

      const allParts = getParts();
      const currentState = getState();
      const isPrinted = currentState.windowsMaterial === 'printed';
      const eligibleParts = allParts.filter(part => !(part.id === 'window' && !isPrinted));
      const randomizedPlacement = _createRandomizedPlacement(eligibleParts.length, randomizeSet);

      eligibleParts.forEach((part, index) => {
        const colorEntry = randomizedPlacement[index];
        if (colorEntry) {
          setPartColor(part.id, colorEntry.id);
        }
      });

      const harmonyLabel = HARMONIES.find(h => h.value === harmony)?.label || harmony;
      if (userColors.length > 0) {
        _showToast(`Randomized using ${userColors.length} Your Color${userColors.length > 1 ? 's' : ''}.`);
      } else {
        _showToast(`Randomized with ${harmonyLabel} harmony.`);
      }
    });
  }
}

function _wireViewSelector() {
  const selector = document.getElementById('view-selector');
  if (!selector) return;

  selector.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nextView = btn.dataset.view;
      if (!nextView || nextView === getCurrentView()) return;

      try {
        await setCurrentView(nextView);
        _syncViewTabs();
      } catch (err) {
        console.error('Failed to switch view:', err);
        _showToast(`Could not load the ${_viewLabel(nextView)} view.`);
      }
    });
  });

  _syncViewTabs();
}

function _wireZoomControls() {
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomIn());
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomOut());
  document.getElementById('btn-zoom-reset')?.addEventListener('click', () => resetViewTransform());
}

function _syncViewTabs() {
  document.querySelectorAll('.view-tab').forEach(btn => {
    const isActive = btn.dataset.view === getCurrentView();
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function _wireWindowsSelector() {
  const radios = document.querySelectorAll('input[name="windows-material"]');
  if (!radios.length) return;

  // Sync radio to current state
  const currentMaterial = getState().windowsMaterial;
  radios.forEach(r => { r.checked = r.value === currentMaterial; });

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        setWindowsMaterial(radio.value);
        // If switching to acrylic, deselect window part so palette isn't confusing
        if (radio.value === 'acrylic' && getState().selectedPartId === 'window') {
          setSelectedPart(null);
        }
      }
    });
  });

  // Keep radios in sync with state (e.g. URL restore)
  subscribe(snap => {
    radios.forEach(r => { r.checked = r.value === snap.windowsMaterial; });
  });
}

function _wireCostPanel(parts) {
  const ballsCheckbox = document.getElementById('include-balls-checkbox');
  if (!ballsCheckbox) return;

  ballsCheckbox.addEventListener('change', () => {
    setIncludeBalls(ballsCheckbox.checked);
  });

  // Update cost panel whenever state changes
  subscribe(snap => {
    _updateCostPanel(snap, parts);
  });

  // Initial cost update
  _updateCostPanel(getState(), parts);
}

function _updateCostPanel(state, parts) {
  const explicitSelections = getExplicitSelections();
  const estimate = calculateBuildCost(explicitSelections, _filamentUsage, parts, state.includeBalls);

  // Update cost displays — Bitty and Biggy filament costs differ, everything
  // else (machine time, balls add-on) is shared across both sizes.
  document.getElementById('cost-filament-bitty').textContent = formatCost(estimate.bitty.filament.totalCost);
  document.getElementById('cost-filament-biggy').textContent = formatCost(estimate.biggy.filament.totalCost);
  document.getElementById('cost-machine').textContent = formatCost(estimate.bitty.machineTime);
  document.getElementById('cost-balls').textContent = state.includeBalls
    ? formatCost(estimate.bitty.balls.cost)
    : '—';
  document.getElementById('cost-total-bitty').textContent = formatCost(estimate.bitty.total);
  document.getElementById('cost-total-biggy').textContent = formatCost(estimate.biggy.total);

  // Update filament breakdown detail (grams/cost per color, Bitty vs Biggy)
  const detailEl = document.getElementById('filament-detail');
  if (detailEl) {
    detailEl.innerHTML = '';
    const colorIds = new Set([
      ...Object.keys(estimate.bitty.filament.colorBreakdown),
      ...Object.keys(estimate.biggy.filament.colorBreakdown),
    ]);

    if (colorIds.size > 0) {
      const colors = getColors();
      const colorMap = {};
      colors.forEach(c => { colorMap[c.id] = c; });

      colorIds.forEach(colorId => {
        const color = colorMap[colorId];
        if (!color) return;
        const bittyData = estimate.bitty.filament.colorBreakdown[colorId] || { grams: 0, kgRounded: 0 };
        const biggyData = estimate.biggy.filament.colorBreakdown[colorId] || { grams: 0, kgRounded: 0 };

        const row = document.createElement('div');
        row.className = 'cost-detail-row';

        const name = document.createElement('span');
        name.className = 'cost-detail-color';
        name.textContent = `${color.name}:`;

        const amount = document.createElement('span');
        amount.className = 'cost-detail-amount';
        amount.textContent = `Bitty ${bittyData.grams}g (${bittyData.kgRounded}kg) · Biggy ${biggyData.grams}g (${biggyData.kgRounded}kg)`;

        row.appendChild(name);
        row.appendChild(amount);
        detailEl.appendChild(row);
      });
    }
  }
}

function _renderPaletteGroups(containerEl, colors, onSwatchClick = null) {
  const grouped = colors.reduce((map, color) => {
    const key = color.series || 'Other';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(color);
    return map;
  }, new Map());

  const sortedSeries = Array.from(grouped.keys()).sort((a, b) => {
    const aIndex = SERIES_ORDER.indexOf(a);
    const bIndex = SERIES_ORDER.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex)
        - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    }
    return a.localeCompare(b);
  });

  sortedSeries.forEach(series => {
    const section = document.createElement('section');
    section.className = 'palette-series';

    const heading = document.createElement('h3');
    heading.className = 'palette-series-title';
    heading.textContent = series;
    section.appendChild(heading);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'palette-series-grid';

    grouped.get(series).forEach(color => {
      const btn = document.createElement('button');
      btn.className = 'color-swatch';
      btn.title = `${color.name} (${color.hex})`;
      btn.dataset.colorId = color.id;
      btn.style.backgroundColor = color.hex;
      btn.setAttribute('aria-label', `${series}: ${color.name}`);

      if (color.hex.toUpperCase() === '#FFFFFF') {
        btn.style.border = '1px solid #ccc';
      }

      btn.addEventListener('click', () => {
        if (onSwatchClick && onSwatchClick(color) === true) {
          return;
        }

        const { selectedPartId, windowsMaterial } = getState();
        if (!selectedPartId) {
          _showToast('Select a part first, then choose a color.');
          return;
        }
        // Block window color selection when acrylic is chosen
        if (selectedPartId === 'window' && windowsMaterial === 'acrylic') {
          _showToast('Switch to "3D printed windows" to choose a window color.');
          return;
        }
        setPartColor(selectedPartId, color.id);
      });

      groupGrid.appendChild(btn);
    });

    section.appendChild(groupGrid);
    containerEl.appendChild(section);
  });
}

function _wireYourColorsTray(colors) {
  const tray = document.getElementById('your-colors-tray');
  if (!tray) return;

  tray.innerHTML = '';
  for (let index = 0; index < USER_COLOR_SLOT_COUNT; index += 1) {
    const button = document.createElement('button');
    button.className = 'user-color-slot';
    button.type = 'button';
    button.dataset.slotIndex = String(index);
    button.addEventListener('click', () => {
      _activeUserColorSlot = index;
      _renderYourColorsTray(colors);
    });
    tray.appendChild(button);
  }

  document.getElementById('btn-clear-active-user-color')?.addEventListener('click', () => {
    if (_activeUserColorSlot === null) {
      _showToast('Select a Your Colors slot first.');
      return;
    }
    _userColorSlots[_activeUserColorSlot] = null;
    _saveUserColorSlots();
    _renderYourColorsTray(colors);
    _showToast('Your Colors slot cleared.');
  });

  _renderYourColorsTray(colors);
}

function _renderYourColorsTray(colors) {
  const tray = document.getElementById('your-colors-tray');
  if (!tray) return;

  tray.querySelectorAll('.user-color-slot').forEach((slotEl, index) => {
    const colorId = _userColorSlots[index];
    const color = colorId ? colors.find(entry => entry.id === colorId) : null;
    slotEl.classList.toggle('active', _activeUserColorSlot === index);
    slotEl.style.backgroundColor = color?.hex || '#f2f2f2';
    slotEl.textContent = color ? `${index + 1}` : '+';
    slotEl.title = color
      ? `Slot ${index + 1}: ${color.name} (${color.hex})`
      : `Slot ${index + 1}: click to activate, then click a palette swatch`;
  });
}

function _assignActiveUserColorSlot(color, colors) {
  if (_activeUserColorSlot === null) return false;
  const slotIndex = _activeUserColorSlot;
  _userColorSlots[_activeUserColorSlot] = color.id;
  _activeUserColorSlot = null;
  _saveUserColorSlots();
  _renderYourColorsTray(colors);
  _showToast(`Saved ${color.name} to Your Colors slot ${slotIndex + 1}.`);
  return true;
}

function _wireSavedBuilds() {
  const listEl = document.getElementById('saved-builds-list');
  const saveButton = document.getElementById('btn-save-build');
  if (!listEl || !saveButton) return;

  const refresh = () => {
    const builds = listBuilds();
    listEl.innerHTML = '';

    builds.forEach(build => {
      const li = document.createElement('li');
      li.className = 'saved-build-item';

      const label = document.createElement('span');
      label.className = 'saved-build-name';
      label.textContent = build.name;
      label.title = `${build.name} — ${new Date(build.savedAt).toLocaleString()}`;
      li.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'saved-build-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-secondary btn-sm';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => {
        setWindowsMaterial(build.windowsMaterial === 'acrylic' ? 'acrylic' : 'printed');
        loadSelections(build.selections || {});
        setSelectedPart(null);
        _showToast(`Loaded build: ${build.name}`);
      });
      actions.appendChild(loadBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-secondary btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        const result = deleteBuild(build.id);
        if (!result.ok) {
          _showToast('Could not delete saved build. Check browser storage permissions.');
          return;
        }
        refresh();
        _showToast(`Deleted build: ${build.name}`);
      });
      actions.appendChild(deleteBtn);

      li.appendChild(actions);
      listEl.appendChild(li);
    });

    const remaining = getMaxBuilds() - builds.length;
    saveButton.title = remaining > 0
      ? `${remaining} save slot${remaining > 1 ? 's' : ''} remaining`
      : 'Saved builds are full (max 5). Delete one or overwrite by using an existing name.';
  };

  saveButton.addEventListener('click', () => {
    const existing = listBuilds();
    const entered = prompt('Enter a name for this build:');
    if (entered === null) return;
    const name = entered.trim() || `Build ${existing.length + 1}`;
    const match = existing.find(build => build.name.toLowerCase() === name.toLowerCase());
    const payload = {
      name,
      selections: getState().selections,
      windowsMaterial: getState().windowsMaterial,
    };

    if (match) {
      const shouldOverwrite = confirm(`Overwrite existing saved build "${match.name}"?`);
      if (!shouldOverwrite) return;
      const result = upsertBuild({ ...payload, id: match.id });
      if (!result.ok) {
        _showToast('Could not overwrite saved build. Check browser storage permissions.');
        return;
      }
      refresh();
      _showToast(`Overwrote build: ${name}`);
      return;
    }

    const saved = saveBuild(payload);
    if (!saved.ok) {
      if (saved.reason === 'full') {
        _showToast('Saved builds are full (max 5). Delete one or overwrite an existing name.');
      } else {
        _showToast('Could not save build. Check browser storage permissions.');
      }
      return;
    }
    refresh();
    _showToast(`Saved build: ${name}`);
  });

  refresh();
}

function _loadUserColorSlots(colors) {
  try {
    const raw = window.localStorage.getItem(USER_COLORS_STORAGE_KEY);
    if (!raw) return Array(USER_COLOR_SLOT_COUNT).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array(USER_COLOR_SLOT_COUNT).fill(null);
    const validIds = new Set(colors.map(color => color.id));
    return Array.from({ length: USER_COLOR_SLOT_COUNT }, (_, index) => {
      const value = parsed[index];
      return typeof value === 'string' && validIds.has(value) ? value : null;
    });
  } catch (_) {
    return Array(USER_COLOR_SLOT_COUNT).fill(null);
  }
}

function _saveUserColorSlots() {
  try {
    window.localStorage.setItem(USER_COLORS_STORAGE_KEY, JSON.stringify(_userColorSlots));
  } catch (_) {
    // Ignore storage write errors and keep in-memory state.
  }
}

function _buildRandomizeColorSet(harmony, palette, userColors) {
  if (userColors.length === 0) {
    return randomizeHarmony(harmony, palette).slice(0, USER_COLOR_SLOT_COUNT);
  }
  return userColors.slice(0, USER_COLOR_SLOT_COUNT);
}

function _createRandomizedPlacement(partCount, colorSet) {
  if (!partCount || !colorSet.length) return [];
  const repeated = [];
  while (repeated.length < partCount) {
    repeated.push(...colorSet);
  }
  const assignments = repeated.slice(0, partCount);
  for (let i = assignments.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [assignments[i], assignments[j]] = [assignments[j], assignments[i]];
  }
  return assignments;
}

async function _loadFilamentUsage() {
  try {
    const res = await fetch('./data/filament-usage.json');
    if (!res.ok) return {};
    return await res.json();
  } catch (_) {
    return {};
  }
}

/** Convert the current inline SVG view to a PNG data URL via canvas. */
async function _svgToDataURL(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const viewBox = clone.viewBox?.baseVal;
  const width = Math.max(1, Math.round(viewBox?.width || svgEl.clientWidth || 600));
  const height = Math.max(1, Math.round(viewBox?.height || svgEl.clientHeight || 800));
  clone.setAttribute('viewBox', clone.getAttribute('viewBox') || `0 0 ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const svgStr = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not create a canvas context for PDF export.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not render the current SVG view for PDF export.'));
    img.src = url;
  });
}

async function _renderPreviewSet() {
  const state = getState();
  const labels = ['front', 'side', 'back'];
  const previews = {};

  const results = await Promise.allSettled(labels.map(async viewName => {
    const previewSvg = await createPreviewSVG(viewName, state);
    return { viewName, dataURL: await _svgToDataURL(previewSvg) };
  }));

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      previews[result.value.viewName] = result.value.dataURL;
      return;
    }

    const failedView = labels[index];
    console.warn(`SVG rasterization failed for ${failedView} view, continuing PDF export:`, result.reason);
    previews[failedView] = null;
  });

  return previews;
}

function _viewLabel(viewName) {
  return ({ front: 'Front', side: 'Side', back: 'Back' })[viewName] || 'Front';
}

/** Show a brief toast notification. */
function _showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

init().catch(err => {
  console.error('Failed to initialize app:', err);
  document.getElementById('viewer').innerHTML =
    `<p style="color:red;padding:1rem;">Error loading app: ${err.message}</p>`;
});
