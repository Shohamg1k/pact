// The backend manifest schema (handoff-locked shape — do not change without telling the
// UI and runner tracks). This is BOTH the shape shown to Agent 2 in prompts/backend.md AND
// the schema Gate V2 tier-0 (structural) parse runs against, mirroring how contract.js
// serves Agent 1 + Gate V1 (PRD principle P1/P2).
import { z } from 'zod';

export const BackendModuleSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['model', 'route', 'middleware', 'util', 'config', 'entry', 'test', 'other']),
  // Contract IDs this file implements (feature/api/collection/business-rule). Empty or
  // unknown IDs are rejected by Gate V2 tier 2 as DRIFT_REJECTED (PRD §8.5, §16 VER-2) —
  // not enforced here, since that check needs the contract, not just this file's shape.
  implements: z.array(z.string()).default([]),
  code: z.string(),
  language: z.enum(['js', 'json']).default('js'),
});

export const BackendManifestSchema = z.object({
  meta: z.object({
    schema: z.literal('backend/v1'),
    runId: z.string(),
    contractHash: z.string(), // must equal sha256(architecture.json) byte-for-byte — CORE-4
  }),
  modules: z.array(BackendModuleSchema).min(1),
  server_entry: z.string().min(1),
  package_json: z.object({
    name: z.string(),
    dependencies: z.record(z.string(), z.string()).default({}),
  }),
  gaps: z.array(z.string()).default([]),
});
