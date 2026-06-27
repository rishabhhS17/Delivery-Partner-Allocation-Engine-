import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;

// Animates from the previous value to the next on every change (starts from 0 on first mount).
// Skips straight to the target when the OS has reduced-motion enabled.
export default function CountUp({ value }) {
  const [display, setDisplay] = useState(0);
  const previousRef = useRef(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) return;

    const from = previousRef.current;
    const to = value;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (from === to || reduceMotion) {
      setDisplay(to);
      previousRef.current = to;
      return;
    }

    const start = performance.now();
    const animate = (now) => {
      const progress = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        previousRef.current = to;
      }
    };
    frameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameRef.current);
  }, [value]);

  return display.toLocaleString();
}
