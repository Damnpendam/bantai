// Strict structured-output providers need every property listed as required, so
// "optional" fields are modelled as empty values instead.

export const ragPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "queries", "clarification"],
  properties: {
    action: { type: "string", enum: ["search", "clarify"] },
    queries: {
      type: "array",
      items: { type: "string" },
      description: "One to three standalone search queries. Empty when clarifying.",
    },
    clarification: {
      type: "string",
      description: "A single short question for the user. Empty when searching.",
    },
  },
} as const;

export const ragGradeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sufficient", "missing", "followupQueries"],
  properties: {
    sufficient: {
      type: "boolean",
      description: "True when the passages contain what is needed to answer.",
    },
    missing: { type: "string", description: "What is still missing. Empty when sufficient." },
    followupQueries: {
      type: "array",
      items: { type: "string" },
      description: "Up to two new queries, in different words, likely to find what is missing.",
    },
  },
} as const;

export const ragAnswerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answerable", "answer", "citations"],
  properties: {
    answerable: {
      type: "boolean",
      description: "False when the passages do not contain the answer.",
    },
    answer: { type: "string", description: "The answer, with [n] markers after each claim." },
    citations: {
      type: "array",
      items: { type: "integer" },
      description: "The passage numbers actually relied on.",
    },
  },
} as const;
