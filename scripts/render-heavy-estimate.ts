import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { calculateEstimateCharges } from "../src/domain/calculations";
import type { AdjustmentInput, EstimateSnapshot } from "../src/domain/contracts";

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom" });
const { estimateHtml } = await server.ssrLoadModule("/src/documents/pdf.ts") as typeof import("../src/documents/pdf");

const charges = [
  ["Pre-construction planning and permit coordination", "Site verification, permit allowance, scheduling, utility coordination, and project setup.", 185_000],
  ["Selective demolition and debris disposal", "Protect adjacent finishes; remove existing deck boards, railing, stairs, and damaged framing; haul debris to an approved facility.", 465_000],
  ["Temporary protection and site safety", "Dust control, temporary barriers, daily cleanup, and protection of landscaping and occupied areas.", 125_000],
  ["Excavation and concrete footings", "Twelve frost-depth footings with formed piers, reinforcing steel, concrete placement, and inspection coordination.", 620_000],
  ["Pressure-treated structural framing", "Ground-contact 6x6 posts, built-up beams, joists, blocking, structural connectors, fasteners, and required hardware.", 1_485_000],
  ["Ledger attachment and flashing system", "Remove siding as required, install code-compliant ledger fasteners, self-adhered membrane, metal flashing, and weather-resistant integration.", 355_000],
  ["Premium composite decking", "Approximately 520 square feet, picture-frame border, concealed fasteners, breaker boards, manufacturer-required spacing, and waste allowance.", 1_975_000],
  ["Custom stair framing", "Three stair runs with pressure-treated stringers, intermediate landing, blocking, hardware, and composite tread preparation.", 795_000],
  ["Composite stair treads and risers", "Color-matched composite treads, finished risers, concealed fastening where practical, and clean edge detailing.", 585_000],
  ["Aluminum railing system", "Approximately 96 linear feet of powder-coated railing including posts, rails, balusters, gates, brackets, and stair transitions.", 1_820_000],
  ["Low-voltage stair and post lighting", "Transformer, weather-rated wiring, eight stair lights, twelve post-cap lights, controls, testing, and homeowner orientation.", 485_000],
  ["Under-deck drainage preparation", "Joist-bay membrane system and drainage channels configured for a future finished patio ceiling.", 740_000],
  ["Exterior electrical allowance", "Licensed electrical allowance for two GFCI receptacles, one weatherproof switch, and circuit extension subject to field verification.", 325_000],
  ["Siding and trim restoration", "Reinstall or replace disturbed siding, PVC trim, sealants, flashing accessories, and touch-up work at ledger interfaces.", 285_000],
  ["Finish carpentry details", "Skirt boards, fascia, trim returns, post wraps, access panel, exposed-edge finishing, and coordinated color transitions.", 510_000],
  ["Landscape and grade restoration", "Backfill, rough grading, topsoil, seed, straw, and repair of normal construction access disturbance.", 245_000],
  ["Final cleaning and punch-list completion", "Detailed cleanup, fastener inspection, manufacturer checklist, owner walkthrough, and documented punch-list completion.", 145_000],
  ["Project supervision and coordination", "On-site supervision, material receiving, trade scheduling, inspections, progress communication, and quality-control documentation.", 695_000]
] as const;
const lines = charges.map(([description, details, amountCents], position) => ({ id: `sample-${position + 1}`, position, description, details, amountCents }));
const adjustments: AdjustmentInput[] = [
  { kind: "markup", mode: "percent", value: 1000 },
  { kind: "discount", mode: "fixed", value: 50_000 },
  { kind: "tax", mode: "percent", value: 600 },
  { kind: "deposit", mode: "percent", value: 2500 }
];
const totals = calculateEstimateCharges(lines, adjustments);
const fixture: EstimateSnapshot = {
  estimateId: "sample-heavy-estimate",
  displayId: "EST-J-2026-0042-v03",
  version: 3,
  generatedAt: "2026-09-14T16:00:00.000Z",
  customer: { displayId: "C-0042", name: "Jordan and Taylor Sample", email: "sample.customer@example.com", phone: "724.555.0142", address: "42 Woodland Ridge Drive\nUniontown, PA 15401" },
  job: { displayId: "J-2026-0042", name: "Woodland Ridge Outdoor Living", address: "42 Woodland Ridge Drive\nUniontown, PA 15401", scope: "Replace the existing elevated deck with a code-compliant premium composite deck, custom stair and landing system, aluminum railing, integrated lighting, drainage preparation, and complete exterior finish restoration." },
  lines,
  adjustments,
  totals,
  notes: "This detailed sample demonstrates a large project estimate. Pricing includes the specifically described labor, materials, equipment, supervision, and disposal. Concealed conditions, owner-requested changes, utility conflicts, permit revisions, and work not expressly listed require written approval before proceeding. Material selections are subject to availability. Proposed schedule: 6-8 weeks after permit approval and material delivery. Estimate valid for 30 days."
};

await mkdir("tmp/pdfs", { recursive: true });
await writeFile("tmp/pdfs/heavy-estimate-example.html", estimateHtml(fixture), "utf8");
await server.close();
