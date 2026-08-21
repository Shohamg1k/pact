// Product Manager output (locked shape). Reads the brief; produces personas + a
// prioritised feature list. Never assigns contract-scoped ids (F-xx/API-xx) itself —
// those stay the Solution Architect's job (kernel/validator.js is the only thing that
// enforces id cross-references, and it only knows about the architect's contract
// shape). PM's own feature ids are PMF-xx, informative input for the architect, not a
// second source of truth.
import { z } from 'zod';

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

export const PMFeatureSchema = z.object({
  id: z.string(), // PMF-xx
  name: z.string(),
  description: z.string(),
  priority: z.enum(['must', 'should', 'could']),
  persona_ids: z.array(z.string()).default([]),
});

export const PMOutputSchema = z.object({
  meta: z.object({ schema: z.literal('pm/v1'), chatId: z.string() }),
  personas: z.array(PersonaSchema).min(1),
  features: z.array(PMFeatureSchema).min(1),
  gaps: z.array(z.string()).default([]),
});
