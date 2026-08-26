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
