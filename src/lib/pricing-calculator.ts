/** Ranking for the /pricing volume slider. Going over included deep does not stop screening.
 *  Keep the inline script in src/pages/pricing.ts in this same shape. */

export type CalculatorPlan = { name: string; price: number; included: number; rpm: number };

/** 22 business days × 8 hours. Peak is 4× the average rate across those minutes. */
export const BUSINESS_MINUTES_PER_MONTH = 22 * 8 * 60;
export const PEAK_FACTOR = 4;

export function impliedPeakRpm(monthlyReqs: number): number {
  if (monthlyReqs <= 0) return 0;
  return (monthlyReqs / BUSINESS_MINUTES_PER_MONTH) * PEAK_FACTOR;
}

export function calculatorView(
  reqs: number,
  plans: CalculatorPlan[],
): { priceLabel: Record<string, string>; lowestCost: string; overDeep: string[]; peakRpm: number } {
  const priceLabel: Record<string, string> = {};
  const overDeep: string[] = [];
  const peakRpm = impliedPeakRpm(reqs);
  for (const plan of plans) {
    priceLabel[plan.name] = `$${plan.price}`;
    if (reqs > plan.included) overDeep.push(plan.name);
  }
  const fitting = plans.filter((plan) => plan.rpm >= peakRpm);
  let best: CalculatorPlan;
  if (fitting.length > 0) {
    best = fitting.reduce((a, b) => (a.price <= b.price ? a : b));
  } else {
    best = plans.reduce((a, b) => (a.rpm >= b.rpm ? a : b));
  }
  return { priceLabel, lowestCost: best.name, overDeep, peakRpm };
}
