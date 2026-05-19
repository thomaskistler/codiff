import type { ChangedFile, Walkthrough } from '../types.ts';
import type { WalkthroughNote } from './app-types.ts';

export const emptyWalkthroughNotes = new Map<string, WalkthroughNote>();

export const walkthroughActionLabel: Record<WalkthroughNote['action'], string> = {
  review: 'Review',
  scan: 'Scan',
  skim: 'Skim',
};

export const walkthroughImpactLabel: Record<WalkthroughNote['impact'], string> = {
  contained: 'Contained',
  mechanical: 'Mechanical',
  wide: 'Wide impact',
};

export const getWalkthroughNotes = (walkthrough: Walkthrough | null) => {
  const notes = new Map<string, WalkthroughNote>();
  if (!walkthrough) {
    return notes;
  }

  let order = 0;
  for (const group of walkthrough.groups) {
    for (const file of group.files) {
      if (!notes.has(file.path)) {
        notes.set(file.path, {
          action: file.action,
          context: file.context,
          groupReason: group.reason,
          groupTitle: group.title,
          impact: file.impact,
          order,
          reason: file.reason,
        });
        order += 1;
      }
    }
  }

  return notes;
};

export const orderFilesByWalkthrough = (
  files: ReadonlyArray<ChangedFile>,
  walkthrough: Walkthrough | null,
) => {
  if (!walkthrough) {
    return files;
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const orderedFiles: Array<ChangedFile> = [];
  const seen = new Set<string>();

  for (const group of walkthrough.groups) {
    for (const item of group.files) {
      const file = filesByPath.get(item.path);
      if (file && !seen.has(file.path)) {
        orderedFiles.push(file);
        seen.add(file.path);
      }
    }
  }

  for (const file of files) {
    if (!seen.has(file.path)) {
      orderedFiles.push(file);
    }
  }

  return orderedFiles;
};
