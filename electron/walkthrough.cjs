const { spawn } = require('node:child_process');
const { existsSync, promises: fs } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CODEX_TIMEOUT_MS = 45_000;
const MAX_TOTAL_PATCH_CHARS = 160_000;
const MAX_SECTION_PATCH_CHARS = 4_000;

const walkthroughSchema = {
  additionalProperties: false,
  properties: {
    groups: {
      items: {
        additionalProperties: false,
        properties: {
          files: {
            items: {
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['path', 'reason'],
              type: 'object',
            },
            type: 'array',
          },
          reason: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['title', 'reason', 'files'],
        type: 'object',
      },
      type: 'array',
    },
    summary: { type: 'string' },
    version: { const: 1, type: 'number' },
  },
  required: ['version', 'summary', 'groups'],
  type: 'object',
};

const getCodexCommand = () => {
  if (process.env.CODIFF_CODEX_PATH) {
    return process.env.CODIFF_CODEX_PATH;
  }

  for (const path of ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']) {
    if (existsSync(path)) {
      return path;
    }
  }

  return 'codex';
};

const oneLine = (value, fallback = '') =>
  (typeof value === 'string' ? value : fallback).replace(/\s+/g, ' ').trim();

const truncate = (value, maxLength) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
};

const buildPatchExcerpt = (section, remainingBudget) => {
  const summary = section.summary?.reason ? `Summary: ${section.summary.reason}\n` : '';
  const patch = section.patch || '';
  const maxLength = Math.max(
    0,
    Math.min(MAX_SECTION_PATCH_CHARS, remainingBudget - summary.length),
  );

  if (maxLength === 0) {
    return summary || '[patch omitted: budget exhausted]';
  }

  return `${summary}${truncate(patch, maxLength)}`;
};

const buildPromptInput = (state) => {
  let remainingPatchBudget = MAX_TOTAL_PATCH_CHARS;

  return {
    files: state.files.map((file) => ({
      oldPath: file.oldPath,
      path: file.path,
      sections: file.sections.map((section) => {
        const patchExcerpt = buildPatchExcerpt(section, remainingPatchBudget);
        remainingPatchBudget = Math.max(0, remainingPatchBudget - patchExcerpt.length);

        return {
          binary: section.binary,
          kind: section.kind,
          loadState: section.loadState,
          patchExcerpt,
          summary: section.summary?.reason,
        };
      }),
      status: file.status,
    })),
    generatedAt: state.generatedAt,
    root: state.root,
    source: state.source,
  };
};

const buildPrompt = (state) => `You are helping Codiff order a code review.

Return a review walkthrough order, not review findings.
Do not inspect the repository or run shell commands; use only the digest below.
Use every provided path exactly once.
Prefer a top-down reading order: entry points, public contracts, core data flow, implementation, tests, docs, then config.
Keep related files adjacent.
Use concise group titles.
Give each file one short reason, max 140 characters.
Do not mention files that were not provided.
Return JSON only.

Repository change digest:
${JSON.stringify(buildPromptInput(state), null, 2)}
`;

const parseJSONMessage = (message) => {
  try {
    return JSON.parse(message);
  } catch {
    const match = message.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Codex did not return JSON.');
    }

    return JSON.parse(match[0]);
  }
};

const normalizeWalkthrough = (input, files) => {
  const pathSet = new Set(files.map((file) => file.path));
  const seen = new Set();
  const groups = [];

  for (const group of Array.isArray(input?.groups) ? input.groups : []) {
    const nextFiles = [];

    for (const file of Array.isArray(group?.files) ? group.files : []) {
      const path = oneLine(file?.path);
      if (!pathSet.has(path) || seen.has(path)) {
        continue;
      }

      seen.add(path);
      nextFiles.push({
        path,
        reason: truncate(
          oneLine(file?.reason, 'Review this file in this part of the change.'),
          160,
        ),
      });
    }

    if (nextFiles.length > 0) {
      groups.push({
        files: nextFiles,
        reason: truncate(oneLine(group?.reason, 'These files are related.'), 180),
        title: truncate(oneLine(group?.title, 'Walkthrough'), 80),
      });
    }
  }

  const missingFiles = files
    .filter((file) => !seen.has(file.path))
    .map((file) => ({
      path: file.path,
      reason: 'Review after the primary walkthrough; Codex did not place this file.',
    }));

  if (missingFiles.length > 0) {
    groups.push({
      files: missingFiles,
      reason: 'Files not included in the Codex walkthrough response.',
      title: 'Other changed files',
    });
  }

  if (groups.length === 0 && files.length > 0) {
    throw new Error('Codex did not return any changed files.');
  }

  return {
    groups,
    summary: truncate(
      oneLine(input?.summary, 'Review the changed files in walkthrough order.'),
      240,
    ),
    version: 1,
  };
};

const runCodex = async (repoRoot, prompt) => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'codiff-walkthrough-'));
  const outputPath = join(directory, 'walkthrough.json');
  const schemaPath = join(directory, 'schema.json');
  await fs.writeFile(schemaPath, JSON.stringify(walkthroughSchema), 'utf8');

  return await new Promise((resolve, reject) => {
    let stderr = '';
    let stdinError = null;
    let stdout = '';
    let finished = false;

    const child = spawn(
      getCodexCommand(),
      [
        'exec',
        '-c',
        'model_reasoning_effort="low"',
        '--cd',
        repoRoot,
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--ignore-rules',
        '--color',
        'never',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '-',
      ],
      {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill('SIGTERM');
        reject(new Error('Codex walkthrough timed out.'));
      }
    }, CODEX_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on('error', (error) => {
      stdinError = error;
    });
    child.on('error', (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', async (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            oneLine(stderr || stdout || stdinError?.message, `Codex exited with code ${code}.`),
          ),
        );
        return;
      }

      try {
        const message = await fs.readFile(outputPath, 'utf8');
        resolve(message);
      } catch {
        resolve(stdout);
      }
    });

    child.stdin.end(prompt, () => {});
  }).finally(() => fs.rm(directory, { force: true, recursive: true }).catch(() => {}));
};

const readWalkthrough = async (state) => {
  if (state.files.length === 0) {
    return {
      status: 'ready',
      walkthrough: {
        groups: [],
        summary: 'No changed files.',
        version: 1,
      },
    };
  }

  try {
    const response = await runCodex(state.root, buildPrompt(state));
    const parsed = parseJSONMessage(response);

    return {
      status: 'ready',
      walkthrough: normalizeWalkthrough(parsed, state.files),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        reason:
          'Codex is not installed locally. Install and use Codex, then try Walkthrough again.',
        status: 'unavailable',
      };
    }

    return {
      reason: error instanceof Error ? error.message : String(error),
      status: 'unavailable',
    };
  }
};

module.exports = {
  readWalkthrough,
};
