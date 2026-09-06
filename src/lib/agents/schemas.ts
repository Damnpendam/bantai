const PRIORITY = { type: "string", enum: ["P0", "P1", "P2", "P3"] } as const;

export const requirementsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requirements"],
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "source", "category"],
        properties: {
          id: {
            type: "string",
            description: "Stable id in the form REQ-001, numbered from 1 upward.",
          },
          text: {
            type: "string",
            description:
              "One atomic, testable requirement, restated as a single clear sentence.",
          },
          source: {
            type: "string",
            description: "Document name plus section or heading it came from.",
          },
          category: {
            type: "string",
            description:
              "Feature area, e.g. authentication, checkout, reporting, notifications.",
          },
        },
      },
    },
  },
} as const;

export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "productSummary",
    "riskAreas",
    "entryCriteria",
    "exitCriteria",
    "briefs",
  ],
  properties: {
    productSummary: {
      type: "string",
      description: "Three to five sentences on what is being tested.",
    },
    riskAreas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "rationale", "severity"],
        properties: {
          area: { type: "string" },
          rationale: { type: "string" },
          severity: PRIORITY,
        },
      },
    },
    entryCriteria: { type: "array", items: { type: "string" } },
    exitCriteria: { type: "array", items: { type: "string" } },
    briefs: {
      type: "array",
      description: "Exactly one brief per discipline listed in the prompt.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "discipline",
          "focus",
          "requirementIds",
          "targetCount",
          "outOfScope",
        ],
        properties: {
          discipline: {
            type: "string",
            enum: [
              "sanity",
              "smoke",
              "unit",
              "functional",
              "edge",
              "monkey",
              "creative",
              "adversarial",
            ],
          },
          focus: {
            type: "string",
            description:
              "What this agent should concentrate on for this specific product, in two to four sentences. Be concrete about features and risks, not generic about the discipline.",
          },
          requirementIds: {
            type: "array",
            items: { type: "string" },
            description: "Requirement ids this suite must cover.",
          },
          targetCount: { type: "integer", minimum: 1, maximum: 120 },
          outOfScope: {
            type: "string",
            description:
              "What this agent must leave to another agent, naming that agent.",
          },
        },
      },
    },
  },
} as const;

export const casesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cases"],
  properties: {
    cases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "priority",
          "preconditions",
          "steps",
          "expected",
          "requirementIds",
          "tags",
          "automatable",
        ],
        properties: {
          title: {
            type: "string",
            description:
              "A specific, falsifiable statement of what is being tested. Never generic.",
          },
          priority: PRIORITY,
          preconditions: {
            type: "string",
            description: "System and data state required before step 1.",
          },
          steps: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Numbered actions, one action per entry.",
          },
          expected: {
            type: "string",
            description:
              "The observable result. Concrete enough that two testers would agree on pass or fail.",
          },
          requirementIds: {
            type: "array",
            items: { type: "string" },
            description:
              "Ids of requirements this case exercises. Use an empty array only for a case with no stated requirement behind it.",
          },
          tags: { type: "array", items: { type: "string" } },
          automatable: { type: "boolean" },
        },
      },
    },
  },
} as const;

const ENTITY_KIND = {
  type: "string",
  enum: [
    "capability",
    "screen",
    "actor",
    "data_object",
    "state",
    "rule",
    "event",
    "constraint",
  ],
} as const;

const EDGE_KIND = {
  type: "string",
  enum: ["governs", "mutates", "precedes", "requires", "belongs_to", "contradicts"],
} as const;

export const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entities", "edges"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "kind", "name", "summary", "quotes"],
        properties: {
          ref: {
            type: "string",
            description:
              "A short document-local handle like E1, E2, E3 — used only to wire up the edges below.",
          },
          kind: ENTITY_KIND,
          name: {
            type: "string",
            description:
              "The product's own name for this thing. Prefer the exact term the document uses.",
          },
          summary: {
            type: "string",
            description: "One sentence: what this is and what it is for.",
          },
          quotes: {
            type: "array",
            items: { type: "string" },
            description:
              "One to three verbatim spans from the document that assert this entity exists.",
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "kind", "quote", "confidence"],
        properties: {
          from: {
            type: "string",
            description: "The `ref` of the source entity (E1, E2, …).",
          },
          to: {
            type: "string",
            description: "The `ref` of the target entity.",
          },
          kind: EDGE_KIND,
          quote: {
            type: "string",
            description:
              "A verbatim span from the document that states this relationship.",
          },
          confidence: {
            type: "number",
            description:
              "How firmly the document states this, 0 to 1. Explicit statement ~1.0; reasonable inference ~0.6; a guess ~0.3.",
          },
        },
      },
    },
  },
} as const;

export const resolutionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "verdict", "reason"],
        properties: {
          ref: { type: "string", description: "The extracted entity's ref." },
          verdict: {
            type: "string",
            enum: ["match", "new", "ambiguous"],
            description:
              "match: it is one of the candidates. new: none of the candidates is the same thing. ambiguous: cannot tell from the evidence given.",
          },
          entityId: {
            type: "string",
            description: "When verdict is match: the id of the candidate it matches.",
          },
          candidateIds: {
            type: "array",
            items: { type: "string" },
            description:
              "When verdict is ambiguous: the candidate ids that could each plausibly be it.",
          },
          reason: {
            type: "string",
            description: "One sentence justifying the verdict.",
          },
        },
      },
    },
  },
} as const;

export const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "duplicateIds",
    "uncoveredRequirementIds",
    "gapsByDiscipline",
    "qualityNotes",
  ],
  properties: {
    duplicateIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Ids of cases to drop because an earlier case already covers the same behaviour. Keep the stronger one.",
    },
    uncoveredRequirementIds: { type: "array", items: { type: "string" } },
    gapsByDiscipline: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["discipline", "gaps"],
        properties: {
          discipline: {
            type: "string",
            enum: [
              "sanity",
              "smoke",
              "unit",
              "functional",
              "edge",
              "monkey",
              "creative",
              "adversarial",
            ],
          },
          gaps: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific missing cases, each phrased as an instruction the agent can act on.",
          },
        },
      },
    },
    qualityNotes: {
      type: "array",
      items: { type: "string" },
      description: "Up to eight observations about the suite as a whole.",
    },
  },
} as const;
