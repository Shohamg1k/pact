// CONN-1 — Postman / OpenAPI (PRD §18). Deterministic file export, no model call, no
// external API — just openapi.yaml (already derived by agents/derive.js) plus a Postman
// Collection v2.1 built from the same contract data. Every connector write still passes
// through gate.js (SEC-1) at the route layer; this module itself is pure and side-effect-
// free except for the two files it writes to the caller-given output directory.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deriveOpenApi } from '../agents/derive.js';

/** A readable placeholder body from the contract's free-text request-shape hints — not
 * real data, just enough for a human to see the shape and fill in real values in Postman. */
function sampleBody(api) {
  if (!api.request) return undefined;
  return JSON.stringify(api.request, null, 2);
}

/** Pure function: contract -> Postman Collection v2.1 object. No I/O. */
export function buildPostmanCollection(contract, opts = {}) {
  const baseUrl = opts.baseUrl ?? 'http://127.0.0.1:3000';
  return {
    info: {
      name: contract.meta.id,
      _postman_id: contract.meta.id,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [{ key: 'baseUrl', value: baseUrl }],
    item: (contract.apis ?? []).map((api) => {
      const body = sampleBody(api);
      return {
        name: `${api.id} — ${api.method} ${api.path}`,
        request: {
          method: api.method,
          header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
          url: {
            raw: `{{baseUrl}}${api.path}`,
            host: ['{{baseUrl}}'],
            path: api.path.split('/').filter(Boolean),
          },
          ...(body ? { body: { mode: 'raw', raw: body } } : {}),
          description: (api.rules ?? []).join('\n') || undefined,
        },
        response: [],
      };
    }),
  };
}

/**
 * Writes openapi.yaml + postman_collection.json to `outputDir`.
 * @param {string} outputDir - absolute path, caller-owned (see runner.js's file-header rule)
 * @param {object} contract - the validated architecture contract
 * @param {{baseUrl?: string}} [opts]
 */
export async function exportPostman(outputDir, contract, opts = {}) {
  await mkdir(outputDir, { recursive: true });
  const openapi = deriveOpenApi(contract);
  const collection = buildPostmanCollection(contract, opts);
  const openapiPath = path.join(outputDir, 'openapi.yaml');
  const collectionPath = path.join(outputDir, 'postman_collection.json');
  await writeFile(openapiPath, openapi, 'utf8');
  await writeFile(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
  return { connector: 'postman', files: [openapiPath, collectionPath], apiCount: (contract.apis ?? []).length };
}
