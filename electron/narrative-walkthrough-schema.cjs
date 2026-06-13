// @ts-check

const IMPORTANCES = new Set(['critical', 'normal', 'context']);
const ICONS = new Set(['bug', 'wrench', 'path', 'flask', 'beaker', 'doc', 'gear']);
const AGENTS = new Set(['codex', 'claude', 'pi']);
const CHANGE_TYPES = new Set([
  'fix',
  'feature',
  'refactor',
  'test',
  'generated',
  'lockfile',
  'snapshot',
  'i18n',
  'docs',
]);

const MAX_WALKTHROUGH_CHAPTERS = 6;
const MAX_WALKTHROUGH_STOPS = 14;
const MAX_HUNKS_PER_WALKTHROUGH_GROUP = 14;
const MAX_BLOCKS_PER_STOP = 20;

const hunkGroupProperties = {
  changeType: { enum: [...CHANGE_TYPES], type: 'string' },
  commitNote: { type: 'string' },
  id: { type: 'string' },
  summary: { type: 'string' },
  title: { type: 'string' },
};

// Keep in sync with src/walkthrough/narrative-walkthrough.schema.json;
// electron/__tests__/narrative-walkthrough.test.ts enforces equality.
// Authoring agents constrain output to it; the renderer trusts only the
// normalized result, not the raw schema-valid input.
const narrativeWalkthroughSchema = {
  additionalProperties: false,
  properties: {
    commit: {
      additionalProperties: false,
      properties: {
        body: { type: 'string' },
        title: { type: 'string' },
      },
      type: 'object',
    },
    chapters: {
      items: {
        additionalProperties: false,
        properties: {
          blurb: { type: 'string' },
          icon: { enum: [...ICONS], type: 'string' },
          id: { type: 'string' },
          stops: {
            items: {
              additionalProperties: false,
              properties: {
                blocks: {
                  description: 'Ordered sequence of content blocks for this stop.',
                  items: {
                    additionalProperties: false,
                    properties: {
                      html: {
                        description: 'Inline HTML. Mutually exclusive with htmlFile.',
                        type: 'string',
                      },
                      htmlFile: {
                        description:
                          'Path to an HTML file relative to the walkthrough JSON. Mutually exclusive with html.',
                        type: 'string',
                      },
                      hunkId: {
                        description: 'Deterministic hunk id from the repository digest.',
                        type: 'string',
                      },
                      note: {
                        description: "Short header note shown above this hunk's diff panel.",
                        type: 'string',
                      },
                      prose: { description: 'Markdown prose for a markup block.', type: 'string' },
                      type: {
                        description:
                          'Block kind: markup renders markdown, hunk renders a single diff hunk, html renders an iframe.',
                        enum: ['markup', 'hunk', 'html'],
                        type: 'string',
                      },
                    },
                    required: ['type'],
                    type: 'object',
                  },
                  maxItems: MAX_BLOCKS_PER_STOP,
                  minItems: 1,
                  type: 'array',
                },
                ...hunkGroupProperties,
                importance: { enum: [...IMPORTANCES], type: 'string' },
              },
              required: ['id', 'importance', 'blocks'],
              type: 'object',
            },
            maxItems: MAX_WALKTHROUGH_STOPS,
            type: 'array',
          },
          title: { maxLength: 16, type: 'string' },
        },
        required: ['id', 'title', 'icon', 'blurb', 'stops'],
        type: 'object',
      },
      maxItems: MAX_WALKTHROUGH_CHAPTERS,
      type: 'array',
    },
    focus: { type: 'string' },
    kind: { const: 'narrative', type: 'string' },
    support: {
      items: {
        additionalProperties: false,
        properties: {
          blocks: {
            description: 'Ordered sequence of content blocks for this stop.',
            items: {
              additionalProperties: false,
              properties: {
                html: {
                  description: 'Inline HTML. Mutually exclusive with htmlFile.',
                  type: 'string',
                },
                htmlFile: {
                  description:
                    'Path to an HTML file relative to the walkthrough JSON. Mutually exclusive with html.',
                  type: 'string',
                },
                hunkId: {
                  description: 'Deterministic hunk id from the repository digest.',
                  type: 'string',
                },
                note: {
                  description: "Short header note shown above this hunk's diff panel.",
                  type: 'string',
                },
                prose: { description: 'Markdown prose for a markup block.', type: 'string' },
                type: {
                  description:
                    'Block kind: markup renders markdown, hunk renders a single diff hunk, html renders an iframe.',
                  enum: ['markup', 'hunk', 'html'],
                  type: 'string',
                },
              },
              required: ['type'],
              type: 'object',
            },
            maxItems: MAX_BLOCKS_PER_STOP,
            minItems: 1,
            type: 'array',
          },
          ...hunkGroupProperties,
          reason: { type: 'string' },
        },
        required: ['id', 'reason', 'blocks'],
        type: 'object',
      },
      type: 'array',
    },
    title: { type: 'string' },
    version: { const: 4, type: 'number' },
  },
  required: ['version', 'kind', 'title', 'focus', 'chapters'],
  type: 'object',
};

const toArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

/**
 * OpenAI structured outputs require every object key to be listed in `required`.
 * Keep Codiff's public schema ergonomic, and derive the stricter response-format
 * schema only for agent calls. Originally optional properties become nullable.
 * @param {any} schema
 * @param {boolean} [optional]
 */
const strictResponseSchema = (schema, optional = false) => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const next = { ...schema };
  const typeValues = toArray(next.type);
  const isObject = typeValues.includes('object') || next.properties;

  if (next.properties && typeof next.properties === 'object') {
    const originalRequired = new Set(Array.isArray(next.required) ? next.required : []);
    const properties = {};
    for (const [key, value] of Object.entries(next.properties)) {
      properties[key] = strictResponseSchema(value, !originalRequired.has(key));
    }
    next.properties = properties;
  }

  if (next.items) {
    next.items = strictResponseSchema(next.items, false);
  }

  if (isObject) {
    next.additionalProperties = false;
    next.required = Object.keys(next.properties || {});
  }

  if (optional) {
    if (Array.isArray(next.enum) && !next.enum.includes(null)) {
      next.enum = [...next.enum, null];
    }

    if (next.type) {
      next.type = [...new Set([...toArray(next.type), 'null'])];
    } else if (next.const !== undefined) {
      next.anyOf = [{ const: next.const }, { type: 'null' }];
      delete next.const;
    }
  }

  return next;
};

const narrativeWalkthroughResponseSchema = strictResponseSchema(narrativeWalkthroughSchema);

module.exports = {
  AGENTS,
  CHANGE_TYPES,
  ICONS,
  IMPORTANCES,
  MAX_BLOCKS_PER_STOP,
  MAX_WALKTHROUGH_CHAPTERS,
  MAX_WALKTHROUGH_STOPS,
  MAX_HUNKS_PER_WALKTHROUGH_GROUP,
  narrativeWalkthroughResponseSchema,
  narrativeWalkthroughSchema,
};
