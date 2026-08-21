// The architecture contract schema (PRD §8.1). This is BOTH the prompt schema shown to
// Agent 1 AND the validator Gate V1 runs — one object, two jobs, so the spec can never
// drift from its own enforcement (PRD principle P1/P2).
import { z } from 'zod';

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.enum(['must', 'should', 'could']),
});

export const AssumptionSchema = z.object({
  id: z.string(),
  statement: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
});

export const CollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(z.string()).min(1),
});

export const ApiSchema = z.object({
  id: z.string(),
  feature_id: z.string(), // REQUIRED — this is the provenance link Gate V1 pass 2/3 check
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().startsWith('/'),
  request: z.record(z.string(), z.any()).optional(),
  response: z.record(z.string(), z.any()).optional(),
  errors: z.array(z.number()).default([]),
  rules: z.array(z.string()).default([]),
});

// --- High-level system diagram (optional) ---------------------------------------
// The Architect draws the system, rather than the UI guessing at it from endpoints: a
// picture of runtime topology (clients, services, datastores, external systems) is a
// different thing from the feature/API list, and only the Architect knows it. Kept
// OPTIONAL so every contract written before this existed still validates — the UI falls
// back to deriving a diagram from features/APIs/collections when it's absent.
export const DiagramGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  sublabel: z.string().optional(),
  parent: z.string().optional(), // groups nest, e.g. a subaccount inside a platform
  lane: z.enum(['left', 'main', 'right']).default('main'), // actors | system | external
});

export const DiagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  sublabel: z.string().optional(),
  group: z.string().optional(),
  // A technology glyph, not a vendor logo — see web/src/tabs/diagramIcons.jsx.
  icon: z.string().default('service'),
  /** What this component does and how it works — shown when the node is clicked. */
  description: z.string().default(''),
  /** Contract ids this component realises, so the picture ties back to the spec. */
  implements: z.array(z.string()).default([]),
});

export const DiagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),   // e.g. 'HTTPS', 'SAML2/OIDC', 'reads'
  kind: z.enum(['request', 'data', 'auth', 'event', 'deploy', 'external']).default('request'),
  optional: z.boolean().default(false), // drawn dashed
  description: z.string().default(''),
});

export const DiagramSchema = z.object({
  groups: z.array(DiagramGroupSchema).default([]),
  nodes: z.array(DiagramNodeSchema).default([]),
  edges: z.array(DiagramEdgeSchema).default([]),
});

export const ArchitectureContractSchema = z.object({
  meta: z.object({
    schema: z.literal('arch-contract/v1'),
    id: z.string(),
    completeness_score: z.number().min(0).max(1),
  }),
  stack: z.object({
    default: z.string().default('MERN'),
    db: z.string().default('mongodb'),
    api: z.string().default('express'),
  }),
  features: z.array(FeatureSchema).min(1),
  assumptions: z.array(AssumptionSchema).default([]),
  business_rules: z.array(z.string()).default([]),
  collections: z.array(CollectionSchema).default([]),
  apis: z.array(ApiSchema).min(1),
  diagram: DiagramSchema.optional(),
});
