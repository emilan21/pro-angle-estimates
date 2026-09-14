export const customerDisplayId = (sequence: number) => `C-${String(sequence).padStart(4, "0")}`;
export const jobDisplayId = (year: number, sequence: number) => `J-${year}-${String(sequence).padStart(4, "0")}`;
export const estimateDisplayId = (jobId: string, version: number) => `EST-${jobId}-v${String(version).padStart(2, "0")}`;

export function safeArtifactFilename(displayId: string, customerName: string, extension: "pdf" | "xlsx" | "csv"): string {
  const safeName = customerName.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "customer";
  return `${displayId}_${safeName}.${extension}`;
}
