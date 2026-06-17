/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { expect, test } from 'vite-plus/test';
import type { NarrativeNavigation } from '../app/components/walkthrough/useNarrativeNavigation.ts';
import { useNarrativeNavigation } from '../app/components/walkthrough/useNarrativeNavigation.ts';
import type { NarrativeWalkthrough, WalkthroughStop } from '../types.ts';
import { renderReact } from './helpers/react.tsx';

const stop = (id: string): WalkthroughStop => ({
  blocks: [],
  id,
  importance: 'normal',
  title: id,
});

const walkthrough: NarrativeWalkthrough = {
  agent: 'codex',
  chapters: [
    {
      blurb: 'Main path',
      icon: 'path',
      id: 'main',
      stops: [stop('first'), stop('second'), stop('third')],
      title: 'Main',
    },
  ],
  focus: 'Focus',
  generatedAt: '2026-06-08T00:00:00.000Z',
  kind: 'narrative',
  repo: { branch: 'main', root: '/repo' },
  source: { type: 'working-tree' },
  support: [],
  title: 'Walkthrough',
  version: 4,
};

function NavigationHarness({
  onNavigation,
}: {
  onNavigation: (navigation: NarrativeNavigation) => void;
}) {
  const navigation = useNarrativeNavigation(walkthrough, []);
  onNavigation(navigation);
  return null;
}

test('clicked walkthrough stops hold selection until target reached or user scroll input releases it', async () => {
  const navigationRef: { current: NarrativeNavigation | null } = { current: null };
  const getNavigation = () => {
    if (!navigationRef.current) {
      throw new Error('Navigation did not render.');
    }
    return navigationRef.current;
  };

  const view = await renderReact(
    <NavigationHarness onNavigation={(next) => (navigationRef.current = next)} />,
  );

  try {
    expect(getNavigation().index).toBe(0);

    await act(async () => {
      getNavigation().goStop(2);
    });
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().syncIndexFromScroll(1);
    });
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().syncIndexFromScroll(2);
    });
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().syncIndexFromScroll(1);
    });
    expect(getNavigation().index).toBe(1);

    await act(async () => {
      getNavigation().goStop(2);
    });
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().releaseStopScrollLock();
      getNavigation().syncIndexFromScroll(1);
    });
    expect(getNavigation().index).toBe(1);
  } finally {
    await view.cleanup();
  }
});

test('support navigation holds support mode until the support block is reached', async () => {
  const navigationRef: { current: NarrativeNavigation | null } = { current: null };
  const getNavigation = () => {
    if (!navigationRef.current) {
      throw new Error('Navigation did not render.');
    }
    return navigationRef.current;
  };

  const view = await renderReact(
    <NavigationHarness onNavigation={(next) => (navigationRef.current = next)} />,
  );

  try {
    await act(async () => {
      getNavigation().goStop(2);
    });
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().openSupport();
    });
    expect(getNavigation().mode).toBe('support');
    expect(getNavigation().supportVisited).toBe(true);

    await act(async () => {
      getNavigation().syncIndexFromScroll(1);
    });
    expect(getNavigation().mode).toBe('support');
    expect(getNavigation().index).toBe(2);

    await act(async () => {
      getNavigation().syncSupportFromScroll();
    });
    expect(getNavigation().mode).toBe('support');

    await act(async () => {
      getNavigation().releaseStopScrollLock();
      getNavigation().syncIndexFromScroll(1);
    });
    expect(getNavigation().mode).toBe('stop');
    expect(getNavigation().index).toBe(1);
  } finally {
    await view.cleanup();
  }
});

// Regression: ReviewCodeView tracks one "last-handled scroll nonce" ref shared by
// stop and support scrolls. If scrolling into support advanced a separate counter
// (or left a stale one), the request would mismatch the handled stop nonce and
// fire a spurious smooth-scroll back to the first support block. The scroll nonce
// must only advance on explicit navigation, never on scroll-driven mode changes.
test('scroll nonce advances only on explicit navigation, not on scroll-driven mode changes', async () => {
  const navigationRef: { current: NarrativeNavigation | null } = { current: null };
  const getNavigation = () => {
    if (!navigationRef.current) {
      throw new Error('Navigation did not render.');
    }
    return navigationRef.current;
  };

  const view = await renderReact(
    <NavigationHarness onNavigation={(next) => (navigationRef.current = next)} />,
  );

  try {
    expect(getNavigation().scrollTarget.nonce).toBe(0);

    // Navigating forward through stops bumps the shared nonce.
    await act(async () => {
      getNavigation().goStop(2);
    });
    const afterStop = getNavigation().scrollTarget.nonce;
    expect(afterStop).toBeGreaterThan(0);

    // Scroll-driven syncs (including into support) must NOT bump the nonce, so the
    // pending scroll request stays equal to the already-handled stop nonce.
    await act(async () => {
      getNavigation().syncIndexFromScroll(2);
    });
    expect(getNavigation().scrollTarget.nonce).toBe(afterStop);

    await act(async () => {
      getNavigation().syncSupportFromScroll();
    });
    expect(getNavigation().mode).toBe('support');
    expect(getNavigation().scrollTarget.nonce).toBe(afterStop);

    // Explicitly opening support DOES bump the nonce, so its scroll fires once.
    await act(async () => {
      getNavigation().openSupport();
    });
    expect(getNavigation().scrollTarget.nonce).toBeGreaterThan(afterStop);
  } finally {
    await view.cleanup();
  }
});
