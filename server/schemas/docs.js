// Documentation output (locked shape). Compiles whatever other roles have produced
// into a technical spec + a user-facing guide (registry.js: docs requires at least one
// other role, reads whatever exists). Pure text synthesis, no code — schema-only gate.
import { z } from 'zod';

export const DocsOutputSchema = z.object({
  meta: z.object({ schema: z.literal('docs/v1'), chatId: z.string() }),
  technical_spec: z.string().min(1), // markdown
  user_guide: z.string().min(1), // markdown
  gaps: z.array(z.string()).default([]),
});
