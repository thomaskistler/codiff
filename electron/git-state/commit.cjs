// @ts-check

const { fileSort, getFingerprint, git, normalizeStatus, readGitFile } = require('./common.cjs');

/**
 * @typedef {import('../../src/types.ts').ChangedFile} ChangedFile
 * @typedef {import('../../src/types.ts').RepositoryState} RepositoryState
 * @typedef {import('./common.cjs').StatusItem} StatusItem
 */

/** @param {string} raw @returns {Array<Pick<StatusItem, 'oldPath' | 'path' | 'status'>>} */
const parseCommitNameStatus = (raw) => {
  const parts = raw.split('\0').filter(Boolean);
  /** @type {Array<Pick<StatusItem, 'oldPath' | 'path' | 'status'>>} */
  const files = [];

  for (let index = 0; index < parts.length; ) {
    const statusCode = parts[index++];
    const statusType = statusCode[0];

    if (statusType === 'R' || statusType === 'C') {
      const oldPath = parts[index++];
      const path = parts[index++];
      files.push({
        oldPath,
        path,
        status: 'renamed',
      });
    } else {
      const path = parts[index++];
      files.push({
        path,
        status: normalizeStatus(statusType),
      });
    }
  }

  return files.sort(fileSort);
};

/** @param {string} launchPath @param {string} ref @returns {Promise<RepositoryState>} */
const readCommitState = async (launchPath, ref) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const commit = (await git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  const status = parseCommitNameStatus(
    await git(repoRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-z',
      '--root',
      '-M',
      commit,
    ]),
  );
  /** @type {Array<ChangedFile>} */
  const files = [];

  for (const item of status) {
    const patch = await git(repoRoot, [
      'show',
      '--format=',
      '--patch',
      '--no-ext-diff',
      '--find-renames',
      commit,
      '--',
      item.path,
    ]);
    const oldFile = await readGitFile(repoRoot, `${commit}^`, item.oldPath || item.path);
    const newFile = await readGitFile(repoRoot, commit, item.path);

    files.push({
      fingerprint: getFingerprint(
        `${commit}\n${item.oldPath || ''}\n${patch}\n${oldFile.file?.contents || ''}\n${
          newFile.file?.contents || ''
        }`,
      ),
      oldPath: item.oldPath,
      path: item.path,
      sections: [
        {
          binary: /Binary files .* differ/.test(patch) || oldFile.binary || newFile.binary,
          id: `${item.path}:${commit}`,
          kind: 'commit',
          newFile: newFile.file,
          oldFile: oldFile.file,
          patch,
        },
      ],
      status: item.status,
    });
  }

  return {
    files,
    generatedAt: Date.now(),
    launchPath,
    root: repoRoot,
    source: {
      ref: commit,
      type: 'commit',
    },
  };
};

/** @param {string} launchPath @param {ReviewSource} [source] @returns {Promise<RepositoryState>} */
const readRepositoryState = async (launchPath, source = { type: 'working-tree' }) =>
  source.type === 'pull-request'
    ? readPullRequestState(launchPath, source)
    : source.type === 'commit'
      ? readCommitState(launchPath, source.ref)
      : readWorkingTreeState(launchPath);

/** @param {string} launchPath @param {number} [limit] */
const listRepositoryHistory = async (launchPath, limit = 200) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const raw = await git(repoRoot, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x1f%P%x1f%ct%x1f%s%x1e',
  ]);
  const entries = [];

  for (const record of raw.split('\x1e')) {
    const [ref, parents, committedAt, subject] = record.trim().split('\x1f');
    if (!ref || !committedAt || subject == null) {
      continue;
    }

    entries.push({
      committedAt: Number(committedAt) * 1000,
      parents: parents ? parents.split(' ') : [],
      ref,
      subject,
    });
  }

  return {
    entries,
    root: repoRoot,
  };
};

module.exports = {
  listRepositoryHistory,
  parseCommitNameStatus,
  readCommitState,
};
