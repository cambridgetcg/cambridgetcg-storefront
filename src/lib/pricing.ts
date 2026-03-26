/**
 * Retail pricing for cambridgetcg.com
 *
 * Wholesale price (from wholesaletcgdirect.com) is the landed cost + 8% margin + VAT.
 * Retail adds a 15% multiplier on top for the consumer-facing storefront.
 *
 * Formula: retail = round(wholesale × 1.15, 2)
 */

export const RETAIL_MULTIPLIER = 1.15;

/**
 * Convert wholesale price_gbp to retail price.
 * All prices on cambridgetcg.com should use this.
 */
export function retailPrice(wholesaleGbp: number): number {
  // Multiply by 1.15 then round UP to nearest £0.10
  return Math.ceil(wholesaleGbp * RETAIL_MULTIPLIER * 10) / 10;
}

/**
 * Format a retail price as a £ string.
 * Examples: 0.57 → "£0.66", 1234.5 → "£1,419.68"
 */
export function formatRetailPrice(wholesaleGbp: number): string {
  const retail = retailPrice(wholesaleGbp);
  return "£" + retail.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
