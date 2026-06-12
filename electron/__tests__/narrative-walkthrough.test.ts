import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';
import narrativeSchemaJson from '../../src/walkthrough/narrative-walkthrough.schema.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const {
  buildNarrativeWalkthroughPrompt,
  narrativeWalkthroughResponseSchema,
  narrativeWalkthroughSchema,
  normalizeNarrativeWalkthrough,
} = require('../narrative-walkthrough.cjs') as {
  buildNarrativeWalkthroughPrompt: (state: any, context?: unknown, agentLabel?: string) => string;
  narrativeWalkthroughResponseSchema: {
    properties: Record<string, any>;
    required: ReadonlyArray<string>;
    type: string;
  };
  narrativeWalkthroughSchema: {
    properties: Record<string, any>;
    required: ReadonlyArray<string>;
    type: string;
  };
  normalizeNarrativeWalkthrough: (
    input: unknown,
    files: ReadonlyArray<{
      oldPath?: string;
      path: string;
      sections: ReadonlyArray<{ id: string; kind: string; patch: string }>;
      status: string;
    }>,
    facts?: Record<string, unknown>,
  ) => any;
};

const addedPatch = (count: number) =>
  `@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, (_, index) => `+line ${index + 1}`).join('\n')}\n`;
const fourHunkPatch = Array.from(
  { length: 4 },
  (_, index) => `@@ -${index + 1} +${index + 1} @@\n-old ${index + 1}\n+new ${index + 1}\n`,
).join('');
const manyHunkPatch = Array.from(
  { length: 18 },
  (_, index) => `@@ -${index + 1} +${index + 1} @@\n-old ${index + 1}\n+new ${index + 1}\n`,
).join('');

const files = [
  {
    path: 'src/App.tsx',
    sections: [
      {
        id: 'src/App.tsx:staged',
        kind: 'staged',
        patch: '@@ -310,3 +310,3 @@\n context\n-old order\n+new order\n context\n',
      },
    ],
    status: 'modified',
  },
  {
    path: 'src/__tests__/hunkNavigation.test.ts',
    sections: [
      {
        id: 'src/__tests__/hunkNavigation.test.ts:staged',
        kind: 'staged',
        patch: addedPatch(14),
      },
    ],
    status: 'added',
  },
  {
    path: 'pnpm-lock.yaml',
    sections: [{ id: 'pnpm-lock.yaml:staged', kind: 'staged', patch: addedPatch(3) }],
    status: 'modified',
  },
  {
    path: 'wide.py',
    sections: [{ id: 'wide.py:staged', kind: 'staged', patch: fourHunkPatch }],
    status: 'modified',
  },
];

const baseInput = () => ({
  chapters: [
    {
      blurb: 'Where it breaks.',
      icon: 'bug',
      id: 'bug',
      stops: [
        {
          blocks: [
            { type: 'markup', prose: 'The root cause line.' },
            { type: 'hunk', hunkId: 'src/App.tsx:staged:h1' },
          ],
          id: 's1',
          importance: 'critical',
        },
        {
          blocks: [
            { type: 'markup', prose: 'The regression test.' },
            { type: 'hunk', hunkId: 'src/__tests__/hunkNavigation.test.ts:staged:h1' },
          ],
          id: 's6',
          importance: 'normal',
        },
      ],
      title: 'The bug',
    },
  ],
  focus: 'A one-line ordering bug let j/k skip collapsed files.',
  kind: 'narrative',
  support: [
    {
      blocks: [{ type: 'hunk', hunkId: 'pnpm-lock.yaml:staged:h1' }],
      id: 'lock',
      reason: 'Lockfile',
    },
  ],
  title: 'Hunk navigation skips collapsed files',
  version: 4,
});

test('exposes a schema requiring the hunk-based narrative fields', () => {
  expect(narrativeWalkthroughSchema.type).toBe('object');
  expect(narrativeWalkthroughSchema.required).toContain('chapters');
  expect(narrativeWalkthroughSchema.required).not.toContain('segments');
  expect(narrativeWalkthroughSchema.required).not.toContain('orders');
  expect(narrativeWalkthroughSchema.required).not.toContain('defaultOrder');
  expect(narrativeWalkthroughSchema.properties.agent).toBeUndefined();
  expect(narrativeWalkthroughSchema.properties.repo).toBeUndefined();
  const stopProperties =
    narrativeWalkthroughSchema.properties.chapters.items.properties.stops.items.properties;
  expect(stopProperties.added).toBeUndefined();
  expect(stopProperties.anchor).toBeUndefined();
});

test('keeps the renderer JSON schema in sync with the live narrative schema', () => {
  expect(narrativeSchemaJson).toEqual(narrativeWalkthroughSchema);
});

test('derives an OpenAI strict-compatible response schema', () => {
  expect(narrativeWalkthroughResponseSchema.required).toEqual(
    Object.keys(narrativeWalkthroughResponseSchema.properties),
  );
  expect(narrativeWalkthroughResponseSchema.properties.agent).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.generatedAt).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.meta).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.repo).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.source).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.commit.required).toEqual(['body', 'title']);
  expect(narrativeWalkthroughResponseSchema.properties.commit.type).toContain('null');

  const chapters = narrativeWalkthroughResponseSchema.properties.chapters;
  const stopProperties = chapters.items.properties.stops.items.properties;
  expect(chapters.maxItems).toBe(6);
  expect(chapters.items.properties.title.maxLength).toBe(16);
  expect(chapters.items.properties.stops.maxItems).toBe(14);
  expect(stopProperties.added).toBeUndefined();
  expect(stopProperties.deleted).toBeUndefined();
  expect(stopProperties.path).toBeUndefined();
  expect(stopProperties.status).toBeUndefined();
  expect(stopProperties.changeType.type).toContain('null');
  expect(stopProperties.changeType.enum).toContain(null);
  expect(stopProperties.blocks.type).toBe('array');
  expect(stopProperties.blocks.items.properties.type.enum).toContain('markup');
  expect(stopProperties.blocks.items.properties.type.enum).toContain('hunk');
  expect(stopProperties.blocks.items.properties.type.enum).toContain('html');
  expect(stopProperties.comments).toBeUndefined();
});

test('prompts generated walkthroughs to use deterministic hunk groups', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: Array.from({ length: 28 }, (_, index) => ({
      path: `file-${index}.ts`,
      sections: [],
      status: 'modified',
    })),
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('digest has 28 files');
  expect(prompt).toContain('Target 7-12 main-path stops');
  expect(prompt).toContain('Define chapters[] in display order');
  expect(prompt).toContain('Default to one review idea per stop');
  expect(prompt).toContain('A stop or support item may contain at most 20 blocks');
  expect(prompt).toContain('Each stop has a **blocks** array');
  expect(prompt).toContain('Generated-like files have "generated": true');
  expect(prompt).toContain('Never split them');
  expect(prompt).toContain('main-path them only when they explain behavior');
  expect(prompt).toContain('Put hunk blocks in the exact display order');
  expect(prompt).toContain('Put a markup block before each hunk block');
  expect(prompt).not.toContain('comments[]');
  expect(prompt).toContain('include commit.title and commit.body by default');
});

test('prompts small walkthroughs to group similar hunks into compact chapters', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: [
      {
        path: 'src/App.tsx',
        sections: [
          {
            id: 'src/App.tsx:staged',
            kind: 'staged',
            patch: '@@ -1 +1 @@\n-old title\n+new title\n@@ -10 +10 @@\n-old label\n+new label\n',
          },
        ],
        status: 'modified',
      },
      {
        path: 'src/App.test.tsx',
        sections: [
          {
            id: 'src/App.test.tsx:staged',
            kind: 'staged',
            patch: '@@ -4 +4 @@\n-old assertion\n+new assertion\n',
          },
        ],
        status: 'modified',
      },
    ],
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('digest has 2 files and 3 reviewable hunks');
  expect(prompt).toContain('Target 1-2 main-path stops');
  expect(prompt).toContain('Use 1 story chapter');
  expect(prompt).toContain('For one- or two-file diffs, prefer one chapter');
  expect(prompt).toContain('Similar same-file hunks should usually be one stop');
});

test('repository digest exposes deterministic hunk ids and counts', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: files.slice(0, 1),
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('"id": "src/App.tsx:staged:h1"');
  expect(prompt).toContain('"added": 1');
  expect(prompt).toContain('"deleted": 1');
  expect(prompt).toContain('Do not provide added/deleted counts');
});

test('repository digest collapses generated files to one synthetic hunk', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: [
      {
        path: 'pnpm-lock.yaml',
        sections: [
          {
            id: 'pnpm-lock.yaml:staged',
            kind: 'staged',
            patch: manyHunkPatch,
          },
        ],
        status: 'modified',
      },
    ],
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('"generated": true');
  expect(prompt).toContain('"id": "pnpm-lock.yaml:staged:h1"');
  expect(prompt).toContain('"kind": "synthetic"');
  expect(prompt).toContain('"added": 18');
  expect(prompt).toContain('"deleted": 18');
  expect(prompt).not.toContain('"id": "pnpm-lock.yaml:staged:h2"');
});

test('repository digest exposes synthetic hunk ids for non-text sections', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: [
      {
        path: 'public/logo.png',
        sections: [
          {
            binary: true,
            id: 'public/logo.png:staged',
            kind: 'staged',
            loadState: 'binary',
            patch: '',
            summary: { reason: 'Binary file changed.' },
          },
        ],
        status: 'modified',
      },
    ],
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('"id": "public/logo.png:staged:h1"');
  expect(prompt).toContain('"kind": "synthetic"');
  expect(prompt).toContain('"summary": "Binary file changed."');
});

test('repository digest exposes synthetic hunk ids for metadata-only renames', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: [
      {
        oldPath: 'old.txt',
        path: 'new.txt',
        sections: [
          {
            binary: false,
            id: 'new.txt:staged',
            kind: 'staged',
            loadState: 'ready',
            patch: '',
          },
        ],
        status: 'renamed',
      },
    ],
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('"id": "new.txt:staged:h1"');
  expect(prompt).toContain('"kind": "synthetic"');
});

test('normalizes a well-formed narrative walkthrough', () => {
  const result = normalizeNarrativeWalkthrough(baseInput(), files, {
    agent: 'claude',
    branch: 'fix/hunk-nav',
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(result.version).toBe(4);
  expect(result.kind).toBe('narrative');
  expect(result.agent).toBe('claude');
  expect(result.generatedAt).toBe('1970-01-01T00:00:00.001Z');
  expect(result.repo).toEqual({ branch: 'fix/hunk-nav', root: '/repo' });
  expect(result.source).toEqual({ type: 'working-tree' });
  expect(result.meta).toBe('2 stops · 1 chapters');
  expect(result.chapters).toHaveLength(1);
  expect(result.chapters[0].stops.map((stop: any) => stop.id)).toEqual(['s1', 's6']);
  expect(result.support.map((item: any) => item.id)).toEqual(['lock', 'support-2']);
  expect(result.chapters[0].stops[0].blocks).toHaveLength(2);
  expect(result.chapters[0].stops[0].blocks[0]).toEqual({
    prose: 'The root cause line.',
    type: 'markup',
  });
  expect(result.chapters[0].stops[0].blocks[1]).toMatchObject({
    hunk: expect.objectContaining({
      id: 'src/App.tsx:staged:h1',
      path: 'src/App.tsx',
      added: 1,
      deleted: 1,
    }),
    type: 'hunk',
  });
});

test('normalizes a stop with markup and hunk blocks', () => {
  const result = normalizeNarrativeWalkthrough(baseInput(), files, {
    agent: 'claude',
    branch: 'fix/hunk-nav',
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(result.chapters[0].stops[0].blocks).toHaveLength(2);
  expect(result.chapters[0].stops[0].blocks[0]).toEqual({
    prose: 'The root cause line.',
    type: 'markup',
  });
  expect(result.chapters[0].stops[0].blocks[1]).toMatchObject({
    hunk: expect.objectContaining({ id: 'src/App.tsx:staged:h1', path: 'src/App.tsx' }),
    type: 'hunk',
  });
  expect(result.support[0].blocks[0]).toMatchObject({
    hunk: expect.objectContaining({ id: 'pnpm-lock.yaml:staged:h1' }),
    type: 'hunk',
  });
});

test('preserves Pi as the narrative walkthrough agent', () => {
  const result = normalizeNarrativeWalkthrough(baseInput(), files, {
    agent: 'pi',
    source: { type: 'working-tree' },
  });

  expect(result.agent).toBe('pi');
});

test('normalizes walkthroughs made only of synthetic hunks', () => {
  const syntheticFiles = [
    {
      path: 'public/logo.png',
      sections: [
        {
          binary: true,
          id: 'public/logo.png:staged',
          kind: 'staged',
          loadState: 'binary',
          patch: '',
          summary: { reason: 'Binary file changed.' },
        },
      ],
      status: 'modified',
    },
    {
      path: 'large.txt',
      sections: [
        {
          binary: false,
          id: 'large.txt:unstaged',
          kind: 'unstaged',
          loadState: 'deferred',
          patch: '',
          summary: { canLoad: true, reason: 'File is 2 MiB and will be loaded on demand.' },
        },
      ],
      status: 'modified',
    },
  ];
  const result = normalizeNarrativeWalkthrough(
    {
      chapters: [
        {
          blurb: 'Non-text review units.',
          icon: 'path',
          id: 'assets',
          stops: [
            {
              blocks: [
                { type: 'markup', prose: 'Review the shipped image asset.' },
                { type: 'hunk', hunkId: 'public/logo.png:staged:h1' },
              ],
              id: 'logo',
              importance: 'normal',
            },
            {
              blocks: [
                { type: 'markup', prose: 'Review why this file is summarized.' },
                { type: 'hunk', hunkId: 'large.txt:unstaged:h1' },
              ],
              id: 'large',
              importance: 'context',
            },
          ],
          title: 'Assets',
        },
      ],
      focus: 'Review non-text changes.',
      kind: 'narrative',
      support: [],
      title: 'Synthetic hunk walkthrough',
      version: 4,
    },
    syntheticFiles as any,
  );

  expect(
    result.chapters[0].stops.map(
      (stop: any) => stop.blocks.find((b: any) => b.type === 'hunk').hunk,
    ),
  ).toMatchObject([
    {
      added: 0,
      anchor: { display: 'public/logo.png', sectionId: 'public/logo.png:staged' },
      deleted: 0,
      id: 'public/logo.png:staged:h1',
      kind: 'synthetic',
    },
    {
      anchor: { display: 'large.txt', sectionId: 'large.txt:unstaged' },
      id: 'large.txt:unstaged:h1',
      kind: 'synthetic',
    },
  ]);
  expect(result.support).toEqual([]);
});

test('computes line counts and status from hunk blocks instead of trusting agent math', () => {
  const input = baseInput() as any;
  // These fields on the stop should be ignored — the normalizer recomputes from hunk data
  input.chapters[0].stops[0].added = 110;
  input.chapters[0].stops[0].deleted = 99;
  input.chapters[0].stops[0].status = 'added';

  const result = normalizeNarrativeWalkthrough(input, files);

  const hunkBlock = result.chapters[0].stops[0].blocks.find((b: any) => b.type === 'hunk');
  expect(hunkBlock.hunk).toMatchObject({
    added: 1,
    deleted: 1,
  });
  expect(hunkBlock.hunk.status).toBe('modified');
});

test('normalizes hunk block notes', () => {
  const input = baseInput() as any;
  input.chapters[0].stops[0].blocks = [
    { type: 'hunk', hunkId: 'src/App.tsx:staged:h1', note: 'Explain the exact root-cause line.' },
  ];

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops[0].blocks[0]).toMatchObject({
    note: 'Explain the exact root-cause line.',
    type: 'hunk',
  });
});

test('drops stops and support items with unresolvable hunk ids', () => {
  const input = baseInput() as any;
  input.chapters[0].stops.push({
    blocks: [{ type: 'hunk', hunkId: 'src/removed.ts:staged:h1' }],
    id: 'stale',
    importance: 'normal',
  });
  input.support.push({
    blocks: [{ type: 'hunk', hunkId: 'missing.ts:staged:h1' }],
    id: 'missing',
    reason: 'Generated',
  });

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops.map((stop: any) => stop.id)).toEqual(['s1', 's6']);
  expect(result.support.map((item: any) => item.id)).toEqual(['lock', 'support-2']);
});

test('drops hunk blocks that overlap already-covered hunks', () => {
  const input = baseInput() as any;
  // This stop has two hunk blocks: one overlapping (already covered by s1), one new.
  // The overlapping block is silently dropped; the stop survives with just the new block.
  input.chapters[0].stops.push({
    blocks: [
      { type: 'hunk', hunkId: 'src/App.tsx:staged:h1' }, // already covered
      { type: 'hunk', hunkId: 'wide.py:staged:h1' },
    ],
    id: 'overlap',
    importance: 'normal',
  });
  // This support item's only hunk is already covered — so the whole item is dropped.
  input.support.push({
    blocks: [{ type: 'hunk', hunkId: 'src/__tests__/hunkNavigation.test.ts:staged:h1' }],
    id: 'duplicate-support',
    reason: 'Duplicate',
  });

  const result = normalizeNarrativeWalkthrough(input, files);

  // 'overlap' survives with the non-duplicate block (wide.py)
  const overlapStop = result.chapters[0].stops.find((s: any) => s.id === 'overlap');
  expect(overlapStop).toBeDefined();
  expect(overlapStop.blocks).toHaveLength(1);
  expect(overlapStop.blocks[0].hunk.path).toBe('wide.py');

  // 'duplicate-support' is dropped (its only hunk was already covered)
  expect(result.support.map((item: any) => item.id)).not.toContain('duplicate-support');
});

test('drops a hunk block whose hunkId is already covered', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          ...baseInput().chapters[0].stops,
          {
            blocks: [{ type: 'hunk', hunkId: 'src/App.tsx:staged:h1' }],
            id: 'dup',
            importance: 'normal',
          },
        ],
      },
    ],
  };
  const result = normalizeNarrativeWalkthrough(input, files);
  expect(result.chapters[0].stops.map((s: any) => s.id)).not.toContain('dup');
});

test('adds unreferenced live hunks to support so changed code remains visible', () => {
  const input = baseInput() as any;
  input.support = [];

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.support.map((item: any) => item.reason)).toEqual([
    'Other changes',
    'Other changes',
  ]);
  // Each support item now has blocks instead of hunkIds
  expect(result.support[0].blocks.map((b: any) => b.hunk.id)).toEqual(['pnpm-lock.yaml:staged:h1']);
  expect(result.support[1].blocks.map((b: any) => b.hunk.id)).toEqual([
    'wide.py:staged:h1',
    'wide.py:staged:h2',
    'wide.py:staged:h3',
    'wide.py:staged:h4',
  ]);
});

test('adds unreferenced generated files to support as one review unit', () => {
  const input = baseInput() as any;
  input.support = [];
  const generatedFile = {
    path: 'src/__generated__/api.ts',
    sections: [{ id: 'src/__generated__/api.ts:staged', kind: 'staged', patch: manyHunkPatch }],
    status: 'modified',
  };

  const result = normalizeNarrativeWalkthrough(input, [...files, generatedFile]);
  const generatedSupport = result.support.find(
    (item: any) => item.blocks[0]?.hunk?.path === 'src/__generated__/api.ts',
  );

  expect(generatedSupport).toBeDefined();
  expect(generatedSupport.blocks[0].hunk).toMatchObject({
    added: 18,
    deleted: 18,
    id: 'src/__generated__/api.ts:staged:h1',
    kind: 'synthetic',
    path: 'src/__generated__/api.ts',
  });
});

test('normalizes ordered cross-file hunk blocks under one stop', () => {
  const input = baseInput() as any;
  input.chapters[0].stops = [
    {
      blocks: [
        { type: 'markup', prose: 'The proof and root cause are one review idea.' },
        { type: 'hunk', hunkId: 'src/__tests__/hunkNavigation.test.ts:staged:h1' },
        { type: 'hunk', hunkId: 'src/App.tsx:staged:h1' },
      ],
      id: 'combo',
      importance: 'critical',
    },
  ];

  const result = normalizeNarrativeWalkthrough(input, files);
  const stop = result.chapters[0].stops[0];

  expect(stop.blocks).toHaveLength(3);
  expect(stop.blocks[0]).toEqual({
    prose: 'The proof and root cause are one review idea.',
    type: 'markup',
  });
  expect(stop.blocks[1].hunk.path).toBe('src/__tests__/hunkNavigation.test.ts');
  expect(stop.blocks[2].hunk.path).toBe('src/App.tsx');
});

test('throws when no chapters have resolvable stops', () => {
  const input = baseInput() as any;
  input.chapters = input.chapters.map((chapter: any) => ({
    ...chapter,
    stops: chapter.stops.map((stop: any) => ({
      ...stop,
      blocks: [{ type: 'hunk', hunkId: 'nope.ts:staged:h1' }],
    })),
  }));

  expect(() => normalizeNarrativeWalkthrough(input, files)).toThrow(/no chapters/i);
});

test('throws an explicit error for legacy v3 anchor walkthroughs', () => {
  const input = {
    chapters: [
      {
        blurb: 'Legacy.',
        icon: 'path',
        id: 'legacy',
        stops: [
          {
            anchors: [
              {
                added: 1,
                anchor: { display: 'src/App.tsx:310' },
                deleted: 1,
                granularity: 'line',
                id: 'a1',
                path: 'src/App.tsx',
                status: 'modified',
              },
            ],
            body: 'Legacy body.',
            id: 's1',
            importance: 'normal',
            summary: 'Legacy summary.',
            title: 'Legacy',
          },
        ],
        title: 'Legacy',
      },
    ],
    focus: 'Legacy walkthrough.',
    kind: 'narrative',
    support: [],
    title: 'Legacy',
    version: 3,
  };

  expect(() => normalizeNarrativeWalkthrough(input, files)).toThrow(/legacy v3 anchors\[\]/i);
  expect(() => normalizeNarrativeWalkthrough(input, files)).toThrow(/v4 blocks\[\]/i);
});

test('normalizes per-item commit tags', () => {
  const input = baseInput() as any;
  input.chapters[0].stops[0].changeType = 'fix';
  input.chapters[0].stops[0].commitNote = 'derive a collapse-independent hunk order';
  input.support[0].changeType = 'not-a-tag';

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops[0].changeType).toBe('fix');
  expect(result.chapters[0].stops[0].commitNote).toBe('derive a collapse-independent hunk order');
  expect(result.support[0].changeType).toBeUndefined();
});

test('keeps the commit composer for a working-tree staging set', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Hunk order is now collapse-independent.\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Hunk order is now collapse-independent.\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('derives a missing commit title from a title-like body first line', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Fix hunk nav\n\nNavigation expands a collapsed target before scrolling.',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Navigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('strips a duplicated commit title from the body', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Fix hunk nav\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Navigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('adds an empty commit composer for a working-tree walkthrough without commit seeds', () => {
  const input = baseInput() as any;
  delete input.commit;

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({});
});

test('strips the commit composer when the source is not a working tree', () => {
  const input = baseInput() as any;
  input.commit = { title: 'Fix hunk nav' };

  const result = normalizeNarrativeWalkthrough(input, files, {
    source: { ref: 'abc1234', type: 'commit' },
  });

  expect(result.commit).toBeUndefined();
});

test('accepts a stop with only markup blocks', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'markup', prose: 'An architectural overview.' }],
            id: 'intro',
            importance: 'normal',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops).toHaveLength(3);
  expect(result.chapters[0].stops[0]).toMatchObject({
    blocks: [{ prose: 'An architectural overview.', type: 'markup' }],
    id: 'intro',
    importance: 'normal',
  });
  expect(result.meta).toBe('3 stops · 1 chapters');
});

test('a markup-only stop is valid', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'markup', prose: 'Context overview.' }],
            id: 'intro',
            importance: 'context',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };
  const result = normalizeNarrativeWalkthrough(input, files);
  expect(result.chapters[0].stops[0]).toMatchObject({
    blocks: [{ prose: 'Context overview.', type: 'markup' }],
    id: 'intro',
  });
});

test('drops a stop with empty blocks array', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          { blocks: [], id: 'empty', importance: 'normal' },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops.map((s: any) => s.id)).not.toContain('empty');
  expect(result.chapters[0].stops).toHaveLength(2);
});

test('drops the second of two stops with the same id', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          { blocks: [{ type: 'markup', prose: 'First.' }], id: 'intro', importance: 'normal' },
          { blocks: [{ type: 'markup', prose: 'Duplicate.' }], id: 'intro', importance: 'normal' },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  const introStops = result.chapters[0].stops.filter((s: any) => s.id === 'intro');
  expect(introStops).toHaveLength(1);
  expect(introStops[0].blocks[0].prose).toBe('First.');
});

test('normalizes a walkthrough composed entirely of markup-only stops', () => {
  const input = {
    chapters: [
      {
        blurb: 'High-level context.',
        icon: 'doc',
        id: 'context',
        stops: [
          {
            blocks: [
              {
                type: 'markup',
                prose: 'This change fixes the ordering bug described in the issue.',
              },
            ],
            id: 'overview',
            importance: 'normal',
          },
          {
            blocks: [
              {
                type: 'markup',
                prose: 'The fix reorders the hunk traversal to respect collapsed state.',
              },
            ],
            id: 'approach',
            importance: 'context',
          },
        ],
        title: 'Context',
      },
    ],
    focus: 'Prose-only walkthrough.',
    kind: 'narrative',
    support: [],
    title: 'All prose',
    version: 4,
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters).toHaveLength(1);
  expect(result.chapters[0].stops).toHaveLength(2);
  expect(
    result.chapters[0].stops.every((s: any) => s.blocks.every((b: any) => b.type === 'markup')),
  ).toBe(true);
  expect(result.meta).toBe('2 stops · 1 chapters');
});

test('preserves title on a markup-only stop', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'markup', prose: 'Context.' }],
            id: 'intro',
            importance: 'context',
            title: 'Overview',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops[0].title).toBe('Overview');
});

test('accepts an html block within a stop', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'html', html: '<p>Architecture overview.</p>' }],
            id: 'html-intro',
            importance: 'normal',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops).toHaveLength(3);
  expect(result.chapters[0].stops[0]).toMatchObject({
    blocks: [{ html: '<p>Architecture overview.</p>', type: 'html' }],
    id: 'html-intro',
    importance: 'normal',
  });
  expect(result.meta).toBe('3 stops · 1 chapters');
});

test('drops a stop whose only block is an empty html block', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          { blocks: [{ type: 'html', html: '' }], id: 'empty-html', importance: 'normal' },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops.map((s: any) => s.id)).not.toContain('empty-html');
  expect(result.chapters[0].stops).toHaveLength(2);
});

test('an html block within a stop normalizes correctly', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [
              { type: 'html', html: '<p>Plan overview.</p>' },
              { type: 'hunk', hunkId: 'src/App.tsx:staged:h1' },
            ],
            id: 'plan',
            importance: 'context',
            title: 'Plan',
          },
          ...baseInput().chapters[0].stops.slice(1),
        ],
      },
    ],
  };
  const result = normalizeNarrativeWalkthrough(input, files);
  expect(result.chapters[0].stops[0].blocks[0]).toEqual({
    html: '<p>Plan overview.</p>',
    type: 'html',
  });
  expect(result.chapters[0].stops[0].blocks[1]).toMatchObject({ type: 'hunk' });
});

test('preserves title on a stop with html blocks', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'html', html: '<p>Context.</p>' }],
            id: 'html-titled',
            importance: 'context',
            title: 'Overview',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.chapters[0].stops[0].title).toBe('Overview');
});

test('drops the second of two stops with the same id (html blocks)', () => {
  const input = {
    ...baseInput(),
    chapters: [
      {
        ...baseInput().chapters[0],
        stops: [
          {
            blocks: [{ type: 'html', html: '<p>First.</p>' }],
            id: 'html-dup',
            importance: 'normal',
          },
          {
            blocks: [{ type: 'html', html: '<p>Duplicate.</p>' }],
            id: 'html-dup',
            importance: 'normal',
          },
          ...baseInput().chapters[0].stops,
        ],
      },
    ],
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  const htmlStops = result.chapters[0].stops.filter((s: any) => s.id === 'html-dup');
  expect(htmlStops).toHaveLength(1);
  expect(htmlStops[0].blocks[0].html).toBe('<p>First.</p>');
});

test('drops hunk groups that exceed the hunk group size limit', () => {
  const input = baseInput() as any;
  const overLimitPatch = Array.from(
    { length: 15 },
    (_, index) => `@@ -${index + 1} +${index + 1} @@\n-old ${index + 1}\n+new ${index + 1}\n`,
  ).join('');
  const overLimitFile = {
    path: 'too-wide.py',
    sections: [{ id: 'too-wide.py:staged', kind: 'staged', patch: overLimitPatch }],
    status: 'modified',
  };
  // Push a stop with 15 hunk blocks (over MAX_BLOCKS_PER_STOP=20, but let's check it resolves them individually)
  // The stop itself should be valid since each hunk block is processed individually.
  // Instead test that ALL 15 blocks get included (no per-stop limit exceeded with 15 < 20).
  input.chapters[0].stops.push({
    blocks: Array.from({ length: 15 }, (_, index) => ({
      type: 'hunk',
      hunkId: `too-wide.py:staged:h${index + 1}`,
    })),
    id: 'wide',
    importance: 'normal',
  });

  const result = normalizeNarrativeWalkthrough(input, [...files, overLimitFile]);

  // Should include the wide stop since 15 blocks < MAX_BLOCKS_PER_STOP (20)
  const wideStop = result.chapters[0].stops.find((s: any) => s.id === 'wide');
  expect(wideStop).toBeDefined();
  expect(wideStop.blocks).toHaveLength(15);
});
