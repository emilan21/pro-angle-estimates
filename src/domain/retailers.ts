export type RetailerCandidate = { retailer: string; sku?: string; modelOrUpc?: string; productUrl?: string; priceCents?: number; storeContext?: string };

export interface RetailerAdapter {
  readonly name: string;
  lookupBySku(sku: string, storeContext?: string): Promise<RetailerCandidate | null>;
  searchCandidates(query: string, storeContext?: string): Promise<RetailerCandidate[]>;
  refreshPrice(candidate: RetailerCandidate): Promise<RetailerCandidate>;
}

export class ManualRetailerAdapter implements RetailerAdapter {
  readonly name = "Manual";
  async lookupBySku(): Promise<null> { return null; }
  async searchCandidates(): Promise<[]> { return []; }
  async refreshPrice(candidate: RetailerCandidate): Promise<RetailerCandidate> { return candidate; }
}

export function normalizeRetailerIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function likelySameProduct(a: RetailerCandidate, b: RetailerCandidate): boolean {
  const aKey = normalizeRetailerIdentity(a.modelOrUpc ?? "");
  const bKey = normalizeRetailerIdentity(b.modelOrUpc ?? "");
  return aKey.length >= 5 && aKey === bKey;
}
