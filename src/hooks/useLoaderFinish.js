// src/hooks/useLoaderFinish.js
//
// Lets a page ask its <LoadingScreen> to finish (sprint to 100%, tick every
// step) and wait for that to complete before navigating to the report --
// so the ring the person has been watching is at 100% at the moment it
// hands over to the score ring. Never blocks longer than `maxMs` (what's
// left of loadingPace's open budget), at most 600 ms, at least 80 ms.
import { useCallback, useRef, useState } from 'react';
import { recordLoaderRect } from '../utils/reportHandoff';

const FINISH_TIMEOUT_MS = 600;
const MIN_FINISH_MS = 80;

export function useLoaderFinish() {
  const [finishing, setFinishing] = useState(false);
  const resolverRef = useRef(null);

  /** Resolves when the loader has reached 100% and recorded its position, or after `maxMs`. */
  const finishLoader = useCallback(
    (maxMs = FINISH_TIMEOUT_MS) =>
      new Promise((resolve) => {
        const done = () => {
          recordLoaderRect();
          resolve();
        };
        resolverRef.current = done;
        setFinishing(true);
        setTimeout(() => {
          if (resolverRef.current === done) {
            resolverRef.current = null;
            done();
          }
        }, Math.max(MIN_FINISH_MS, Math.min(FINISH_TIMEOUT_MS, maxMs)));
      }),
    []
  );

  const onFinished = useCallback(() => {
    const done = resolverRef.current;
    resolverRef.current = null;
    done?.();
  }, []);

  const resetFinish = useCallback(() => setFinishing(false), []);

  return { finishing, finishLoader, onFinished, resetFinish };
}
