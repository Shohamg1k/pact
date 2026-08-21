// Frontend output (locked shape) — mirrors backend/v1's shape deliberately, since it
// goes through the same kind of gate (Tier 1 syntax + drift, gates/frontend.js).
// `implements[]` cites the architect's contract ids, same shared id space as backend
// and uiux — never uiux's own screen slugs, so the trace matrix has one coherent key.
import { z } from 'zod';

export const FrontendModuleSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(['component', 'page', 'hook', 'api-client', 'style', 'config', 'entry', 'test', 'other']),
  implements: z.array(z.string()).default([]),
  code: z.string(),
  language: z.enum(['jsx', 'js', 'css', 'json']).default('jsx'),
});

export const FrontendManifestSchema = z.object({
  meta: z.object({
    schema: z.literal('frontend/v1'),
    chatId: z.string(),
    backendHash: z.string(), // must equal sha256(backend's artifact) byte-for-byte — same CORE-4-style guarantee
  }),
  modules: z.array(FrontendModuleSchema).min(1),
  entry: z.string().min(1),
  package_json: z.object({
    name: z.string(),
    dependencies: z.record(z.string(), z.string()).default({}),
  }),
  gaps: z.array(z.string()).default([]),
});
