#!/usr/bin/env node
// D4 CLI entry — `node server/fixtures/run.mjs <name>`. Runs one demo scenario on demand
// (PRD §22: "the four demo fixtures", §24 T15's rehearsal target) instead of hand-driving
// curl/UI clicks before every rehearsal. No flags, no config file: the scenario name is the
// whole interface, matching the plain, inspectable style the rest of this track uses.
import { SCENARIOS } from './index.js';

const name = process.argv[2];

if (!name || !SCENARIOS[name]) {
  console.error(`usage: node server/fixtures/run.mjs <scenario>\n\nscenarios:\n${Object.keys(SCENARIOS).map((s) => `  ${s}`).join('\n')}`);
  process.exit(1);
}

try {
  const result = await SCENARIOS[name]();
  console.log('\n=== result ===');
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n[fixture] "${name}" completed successfully`);
  process.exit(0);
} catch (e) {
  console.error(`\n[fixture] "${name}" FAILED: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}
