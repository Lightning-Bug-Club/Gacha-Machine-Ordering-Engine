/**
 * pricing.js — Cost estimation engine for custom gacha machines.
 *
 * Cost breakdown:
 * - Filament: $25 per 1kg spool (rounded up per color)
 * - Machine time: $20 flat fee
 * - Optional add-on: 50 clear plastic balls for $25
 */

const FILAMENT_COST_PER_KG = 25;
const MACHINE_TIME_COST = 20;
const BALLS_ADDON_COST = 25;
const BALLS_ADDON_QUANTITY = 50;

/**
 * Calculate total filament grams needed by color, for a given machine size.
 * Only parts that are actually present in `selections` (i.e. explicitly
 * chosen by the user) are counted — default/placeholder colors that were
 * never selected must not leak into the estimate.
 *
 * Returns a map: { colorId: { grams, kgRounded } }
 */
export function calculateFilamentByColor(selections, filamentUsage, parts, size = 'bitty') {
  const result = {};

  // Group parts by color
  Object.entries(selections).forEach(([partId, colorId]) => {
    if (!colorId) return;
    if (!filamentUsage[partId]) return;

    const usage = filamentUsage[partId];
    const part = parts.find(p => p.id === partId);
    if (!part) return;

    // Calculate total grams for this part (qty * filament) for the requested size.
    const gramsPerPart = usage[size] || 0;

    if (!result[colorId]) {
      result[colorId] = { grams: 0, kgRounded: 0 };
    }

    result[colorId].grams += gramsPerPart * (part.qty || 1);
  });

  // Round up to nearest kg
  Object.keys(result).forEach(colorId => {
    const grams = result[colorId].grams;
    result[colorId].kgRounded = Math.ceil(grams / 1000);
  });

  return result;
}

/**
 * Calculate the total filament cost for a given machine size ('bitty' or 'biggy').
 * Returns: { colorBreakdown, totalCost, totalKg, totalGrams }
 */
export function calculateFilamentCost(selections, filamentUsage, parts, size = 'bitty') {
  const filamentByColor = calculateFilamentByColor(selections, filamentUsage, parts, size);
  let totalCost = 0;
  let totalKg = 0;
  let totalGrams = 0;

  const colorBreakdown = {};
  Object.entries(filamentByColor).forEach(([colorId, { grams, kgRounded }]) => {
    const colorCost = kgRounded * FILAMENT_COST_PER_KG;
    totalCost += colorCost;
    totalKg += kgRounded;
    totalGrams += grams;
    colorBreakdown[colorId] = { grams, kgRounded, cost: colorCost };
  });

  return {
    colorBreakdown,
    totalCost,
    totalKg,
    totalGrams,
  };
}

/**
 * Build a single-size cost estimate: { filament, machineTime, balls, ballsAdded, subtotal, total }
 */
function _buildEstimate(selections, filamentUsage, parts, includeBalls, size) {
  const filament = calculateFilamentCost(selections, filamentUsage, parts, size);

  const balls = includeBalls
    ? { cost: BALLS_ADDON_COST, quantity: BALLS_ADDON_QUANTITY }
    : { cost: 0, quantity: 0 };

  const subtotal = filament.totalCost + MACHINE_TIME_COST + balls.cost;

  return {
    filament,
    machineTime: MACHINE_TIME_COST,
    balls,
    ballsAdded: includeBalls,
    subtotal,
    total: subtotal,
  };
}

/**
 * Calculate the complete build cost estimate for both Bitty and Biggy sizes,
 * since their filament usage (and therefore cost) differs.
 *
 * Only colors/parts actually present in `selections` are counted — default
 * placeholder colors that were never chosen by the user are excluded.
 *
 * Returns: {
 *   bitty: { filament, machineTime, balls, ballsAdded, subtotal, total },
 *   biggy: { filament, machineTime, balls, ballsAdded, subtotal, total },
 *   // Backward-compatible fields mirroring the Bitty estimate:
 *   filament, machineTime, balls, ballsAdded, subtotal, total
 * }
 */
export function calculateBuildCost(selections, filamentUsage, parts, includeBalls = false) {
  const bitty = _buildEstimate(selections, filamentUsage, parts, includeBalls, 'bitty');
  const biggy = _buildEstimate(selections, filamentUsage, parts, includeBalls, 'biggy');

  return {
    bitty,
    biggy,
    // Preserve the previous shape (defaults to the Bitty estimate) so existing
    // callers that only look at the top-level fields keep working.
    ...bitty,
  };
}

/**
 * Format a cost for display (USD).
 */
export function formatCost(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Get the cost estimate summary as a human-readable string, summarizing
 * both the Bitty and Biggy sub-estimates returned by calculateBuildCost.
 */
export function getCostSummary(estimate) {
  const lines = [];
  lines.push('Bitty:');
  lines.push(_formatSizeSummary(estimate.bitty).map(l => `  ${l}`).join('\n'));
  lines.push('Biggy:');
  lines.push(_formatSizeSummary(estimate.biggy).map(l => `  ${l}`).join('\n'));
  return lines.join('\n');
}

function _formatSizeSummary(estimate) {
  const lines = [];
  lines.push(`Filament: ${formatCost(estimate.filament.totalCost)} (${estimate.filament.totalKg} kg)`);
  lines.push(`Machine Time: ${formatCost(estimate.machineTime)}`);
  if (estimate.ballsAdded) {
    lines.push(`Clear Plastic Balls (50): ${formatCost(estimate.balls.cost)}`);
  }
  lines.push(`---`);
  lines.push(`Subtotal: ${formatCost(estimate.subtotal)}`);
  lines.push(`Total: ${formatCost(estimate.total)}`);
  return lines;
}
