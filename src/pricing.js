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
 * Calculate total filament grams needed by color.
 * Returns a map: { colorId: { grams, kgRounded } }
 */
export function calculateFilamentByColor(selections, filamentUsage, parts) {
  const result = {};

  // Group parts by color
  Object.entries(selections).forEach(([partId, colorId]) => {
    if (!filamentUsage[partId]) return;

    const usage = filamentUsage[partId];
    const part = parts.find(p => p.id === partId);
    if (!part) return;

    // Calculate total grams for this part (qty * filament)
    // Use bitty size by default (most common)
    const gramsPerPart = usage.bitty || 0;

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
 * Calculate the total filament cost.
 * Returns: { colorBreakdown, totalCost, totalKg, totalGrams }
 */
export function calculateFilamentCost(selections, filamentUsage, parts) {
  const filamentByColor = calculateFilamentByColor(selections, filamentUsage, parts);
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
 * Calculate the complete build cost estimate.
 * Returns: {
 *   filament: { colorBreakdown, totalCost, totalKg, totalGrams },
 *   machineTime: MACHINE_TIME_COST,
 *   balls: { cost, quantity },
 *   ballsAdded: boolean,
 *   subtotal: number,
 *   total: number
 * }
 */
export function calculateBuildCost(selections, filamentUsage, parts, includeBalls = false) {
  const filament = calculateFilamentCost(selections, filamentUsage, parts);

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
 * Get the cost estimate summary as a human-readable string.
 */
export function getCostSummary(estimate) {
  const lines = [];
  lines.push(`Filament: ${formatCost(estimate.filament.totalCost)} (${estimate.filament.totalKg} kg)`);
  lines.push(`Machine Time: ${formatCost(estimate.machineTime)}`);
  if (estimate.ballsAdded) {
    lines.push(`Clear Plastic Balls (50): ${formatCost(estimate.balls.cost)}`);
  }
  lines.push(`---`);
  lines.push(`Subtotal: ${formatCost(estimate.subtotal)}`);
  lines.push(`Total: ${formatCost(estimate.total)}`);
  return lines.join('\n');
}
