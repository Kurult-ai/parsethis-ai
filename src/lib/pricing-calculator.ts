/** Ranking for the /pricing volume slider. Going over included deep does not stop screening.
 *  Keep the inline script in src/pages/pricing.ts in this same shape. */

export type CalculatorPlan = { name: string; price: number; included: number };

export function calculatorView(
  reqs: number,
  plans: CalculatorPlan[],
): { priceLabel: Record<string, string>; lowestCost: string; overDeep: string[] } {
  const priceLabel: Record<string, string> = {};
  const overDeep: string[] = [];
  let best = plans[0];
  for (const plan of plans) {
    priceLabel[plan.name] = `$${plan.price}`;
    if (reqs > plan.included) overDeep.push(plan.name);
    if (plan.price < best.price) best = plan;
  }
  return { priceLabel, lowestCost: best.name, overDeep };
}
