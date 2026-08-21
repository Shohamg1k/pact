// UI/UX output (locked shape). Reads pm's feature list or the architect's contract
// (registry.js: pm OR architect); produces one screen/flow description per major
// feature. `implements[]` cites the ARCHITECT's contract ids (feature/api ids) — the
// one shared id space every downstream role cites into, so the trace matrix stays
// coherent regardless of which roles ran (server/trace.js).
import { z } from 'zod';

export const ScreenSchema = z.object({
  path: z.string().min(1), // a display slug, e.g. "screens/booking-flow" — not a file path
  name: z.string(),
  implements: z.array(z.string()).default([]), // real feature/api ids from the contract
  flow: z.string().min(1), // wireframe / screen-flow description, textual
});

export const UiuxOutputSchema = z.object({
  meta: z.object({ schema: z.literal('uiux/v1'), chatId: z.string() }),
  screens: z.array(ScreenSchema).min(1),
  gaps: z.array(z.string()).default([]),
});
