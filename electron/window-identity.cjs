const { execFileSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const { resolve } = require('node:path');

const getRealPath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const resolveRepositoryRoot = (repositoryPath) => {
  const resolvedPath = resolve(repositoryPath);

  try {
    return getRealPath(
      execFileSync('git', ['-C', resolvedPath, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
      }).trim(),
    );
  } catch {
    return getRealPath(resolvedPath);
  }
};

const resolveCommitRef = (repositoryRoot, ref) => {
  try {
    return execFileSync('git', ['-C', repositoryRoot, 'rev-parse', '--verify', `${ref}^{commit}`], {
      encoding: 'utf8',
    })
      .trim()
      .toLowerCase();
  } catch {
    return null;
  }
};

const parseGitHubPullRequestUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') {
      return null;
    }

    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/);
    return match
      ? {
          number: Number(match[3]),
          owner: match[1],
          repo: match[2].replace(/\.git$/i, ''),
        }
      : null;
  } catch {
    return null;
  }
};

const getPullRequestSourceKey = (source) => {
  const pullRequest =
    source.owner && source.repo && source.number
      ? {
          number: source.number,
          owner: source.owner,
          repo: source.repo,
        }
      : parseGitHubPullRequestUrl(source.url);

  return pullRequest
    ? `pull-request:${pullRequest.owner.toLowerCase()}/${pullRequest.repo.toLowerCase()}#${
        pullRequest.number
      }`
    : null;
};

const getSourceKey = (repositoryRoot, source = { type: 'working-tree' }) => {
  if (source.type === 'working-tree') {
    return 'working-tree';
  }

  if (source.type === 'commit') {
    const commit = resolveCommitRef(repositoryRoot, source.ref);
    return commit ? `commit:${commit}` : null;
  }

  if (source.type === 'pull-request') {
    return getPullRequestSourceKey(source);
  }

  return null;
};

const getWindowIdentity = (repositoryPath, launchOptions = {}) => {
  const repositoryRoot = resolveRepositoryRoot(repositoryPath);
  const sourceKey = getSourceKey(repositoryRoot, launchOptions.source);
  return sourceKey
    ? {
        key: `${repositoryRoot}\0${sourceKey}`,
        repositoryRoot,
        sourceKey,
      }
    : null;
};

const getWindowIdentityForSource = (repositoryPath, source) =>
  getWindowIdentity(repositoryPath, { source });

const findMatchingWindowIdentity = (identity, existingIdentities) => {
  if (!identity) {
    return null;
  }

  for (const [id, existingIdentity] of existingIdentities) {
    if (existingIdentity?.key === identity.key) {
      return id;
    }
  }

  return null;
};

module.exports = {
  findMatchingWindowIdentity,
  getSourceKey,
  getWindowIdentity,
  getWindowIdentityForSource,
  parseGitHubPullRequestUrl,
  resolveRepositoryRoot,
};
