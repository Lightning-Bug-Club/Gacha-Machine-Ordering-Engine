const STORAGE_KEY = 'gatagata.savedBuilds.v1';
const MAX_BUILDS = 5;
const _id = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `build-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function _safeParseBuilds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object')
      .slice(0, MAX_BUILDS)
      .map(item => ({
        id: String(item.id || _id()),
        name: String(item.name || 'Untitled Build'),
        selections: item.selections && typeof item.selections === 'object' ? item.selections : {},
        windowsMaterial: item.windowsMaterial === 'acrylic' ? 'acrylic' : 'printed',
        includeBalls: item.includeBalls === true,
        savedAt: Number(item.savedAt) || Date.now(),
      }));
  } catch (_) {
    return [];
  }
}

function _readBuilds() {
  try {
    return _safeParseBuilds(window.localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return [];
  }
}

function _writeBuilds(builds) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(builds.slice(0, MAX_BUILDS)));
    return true;
  } catch (_) {
    return false;
  }
}

export function listBuilds() {
  return _readBuilds();
}

export function saveBuild({ name, selections, windowsMaterial, includeBalls }) {
  const builds = _readBuilds();
  if (builds.length >= MAX_BUILDS) {
    return { ok: false, reason: 'full', builds };
  }

  const next = {
    id: _id(),
    name: String(name || 'Untitled Build').trim() || 'Untitled Build',
    selections: { ...(selections || {}) },
    windowsMaterial: windowsMaterial === 'acrylic' ? 'acrylic' : 'printed',
    includeBalls: includeBalls === true,
    savedAt: Date.now(),
  };
  const updated = [...builds, next];
  const ok = _writeBuilds(updated);
  return { ok, reason: ok ? null : 'storage', build: next, builds: ok ? updated : builds };
}

export function deleteBuild(id) {
  const builds = _readBuilds();
  const updated = builds.filter(build => build.id !== id);
  const ok = _writeBuilds(updated);
  return { ok, builds: ok ? updated : builds };
}

export function upsertBuild(build) {
  const builds = _readBuilds();
  const id = build?.id ? String(build.id) : '';
  const name = String(build?.name || 'Untitled Build').trim() || 'Untitled Build';
  const payload = {
    id: id || _id(),
    name,
    selections: build?.selections && typeof build.selections === 'object' ? { ...build.selections } : {},
    windowsMaterial: build?.windowsMaterial === 'acrylic' ? 'acrylic' : 'printed',
    includeBalls: build?.includeBalls === true,
    savedAt: Date.now(),
  };
  const index = builds.findIndex(item => item.id === payload.id);
  if (index === -1) {
    if (builds.length >= MAX_BUILDS) {
      return { ok: false, reason: 'full', builds };
    }
    const updated = [...builds, payload];
    const ok = _writeBuilds(updated);
    return { ok, reason: ok ? null : 'storage', build: payload, builds: ok ? updated : builds };
  }
  const updated = [...builds];
  updated[index] = payload;
  const ok = _writeBuilds(updated);
  return { ok, reason: ok ? null : 'storage', build: payload, builds: ok ? updated : builds };
}

export function getMaxBuilds() {
  return MAX_BUILDS;
}
