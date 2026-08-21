// QA output (locked shape). Generates test cases against the defined features/APIs
// (registry.js: qa requires backend, reads pm/architect/backend/frontend). Explicitly
// scoped to GENERATING test cases deterministically-checkable against the contract —
// actually RUNNING them against a live server needs runner.js (feat/runner-connectors),
// not built here. Every test case must cite >=1 real contract id (min(1), enforced by
// schema — an empty implements[] is a schema failure here, not just a gate failure,
// since a test that exercises nothing isn't a test).
import { z } from 'zod';

export const TestCaseSchema = z.object({
  id: z.string(),
  implements: z.array(z.string()).min(1),
  description: z.string(),
  steps: z.array(z.string()).min(1),
  expected: z.string(),
});

export const QAOutputSchema = z.object({
  meta: z.object({ schema: z.literal('qa/v1'), chatId: z.string() }),
  test_cases: z.array(TestCaseSchema).min(1),
  gaps: z.array(z.string()).default([]),
});
