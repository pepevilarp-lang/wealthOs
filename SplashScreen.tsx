'use client';

import { useEffect, useRef, useState } from 'react';

const PERIOD_MS = 2200;
const FAST_MIN_MS = 800;
const MAX_MS = 7000;
const EXIT_FADE_MS = 550;

export default function SplashScreen({
  ready,
  onDone,
}: {
  ready: boolean;
  onDone?: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  const startRef = useRef<number>(0);
  const minRef = useRef<number>(FAST_MIN_MS);
  const firedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ----------------------------
  // INIT (first mount only)
  // ----------------------------
  useEffect(() => {
    startRef.current = performance.now();

    let firstOpen = false;

    try {
      firstOpen = !localStorage.getItem('orbit_splash_seen');
    } catch {
      firstOpen = false;
    }

    // mark immediately BUT safe (no crash SSR / private mode)
    try {
      localStorage.setItem('orbit_splash_seen', '1');
    } catch {}

    minRef.current = firstOpen ? PERIOD_MS : FAST_MIN_MS;

    const safety = setTimeout(() => {
      beginLeave();
    }, MAX_MS);

    return () => clearTimeout(safety);
  }, []);

  // ----------------------------
  // READY TRIGGER
  // ----------------------------
  useEffect(() => {
    if (!ready) return;

    const elapsed = performance.now() - startRef.current;
    const wait = Math.max(0, minRef.current - elapsed);

    const t = setTimeout(() => {
      beginLeave();
    }, wait);

    return () => clearTimeout(t);
  }, [ready]);

  // ----------------------------
  // EXIT LOGIC (single source of truth)
  // ----------------------------
  function beginLeave() {
    if (firedRef.current) return;
    firedRef.current = true;

    setLeaving(true);

    const finish = () => onDone?.();

    // prefer state-driven fallback instead of DOM dependency
    setTimeout(finish, EXIT_FADE_MS + 50);
  }

  return (
    <div
      ref={rootRef}
      id="orbit-splash"
      aria-hidden="true"
      className={leaving ? 'leaving' : ''}
    >
      <div className="mark">
        <svg className="svg" viewBox="0 0 200 200" fill="none">
          <defs>
            <linearGradient id="splOrbit" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#1D4ED8" />
              <stop offset=".55" stopColor="#2563EB" />
              <stop offset="1" stopColor="#60A5FA" />
            </linearGradient>

            <radialGradient id="splRing" cx=".5" cy=".4" r=".62">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#cbd5e1" />
            </radialGradient>
          </defs>

          <g transform="rotate(-20 100 100)">
            <ellipse
              cx="100"
              cy="100"
              rx="88"
              ry="32"
              stroke="url(#splOrbit)"
              strokeWidth="2"
              opacity=".85"
            />
          </g>

          <circle
            cx="100"
            cy="100"
            r="58"
            stroke="url(#splRing)"
            strokeWidth="12"
          />
        </svg>

        <div className="planetOrbit">
          <div className="planet" />
        </div>
      </div>

      <div className="word">ORBIT</div>

      <style jsx>{`
        #orbit-splash {
          position: fixed;
          inset: 0;
          z-index: 999999;
          background: #0f172a;

          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;

          gap: 28px;

          opacity: 1;
          transition: opacity 550ms cubic-bezier(0.4, 0, 0.2, 1),
            transform 550ms cubic-bezier(0.4, 0, 0.2, 1);

          will-change: opacity, transform;
        }

        #orbit-splash.leaving {
          opacity: 0;
          transform: scale(1.02);
          pointer-events: none;
        }

        .mark {
          position: relative;
          width: 200px;
          height: 200px;
          transform: scale(var(--s, 0.78));
          animation: markIn 0.6s ease-out both;
        }

        @keyframes markIn {
          from {
            opacity: 0;
            transform: scale(0.72);
          }
          to {
            opacity: 1;
            transform: scale(var(--s, 0.78));
          }
        }

        .svg {
          position: absolute;
          inset: 0;
          width: 200px;
          height: 200px;
          filter: drop-shadow(0 0 10px rgba(37, 99, 235, 0.15));
        }

        .planetOrbit {
          position: absolute;
          inset: 0;
          transform: rotate(-20deg);
        }

        .planet {
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 50%;

          offset-anchor: 50% 50%;
          offset-rotate: 0deg;
          offset-distance: 0%;

          offset-path: path(
            'M 12 100 A 88 32 0 1 1 188 100 A 88 32 0 1 1 12 100'
          );

          background: radial-gradient(
            circle at 30% 30%,
            #93c5fd,
            #2563eb 60%,
            #1e3a8a
          );

          box-shadow: 0 0 4px rgba(37, 99, 235, 0.25);

          animation: move ${PERIOD_MS}ms linear infinite,
            depth ${PERIOD_MS}ms ease-in-out infinite;

          will-change: offset-distance, transform, opacity;
        }

        @keyframes move {
          to {
            offset-distance: 100%;
          }
        }

        @keyframes depth {
          0% {
            transform: scale(0.95);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(0.95);
            opacity: 0.8;
          }
        }

        .word {
          font-family: Inter, system-ui, sans-serif;
          font-size: 15px;
          letter-spacing: 0.45em;
          color: #e2e8f0;
          opacity: 0;
          animation: wordIn 0.6s ease-out 0.15s forwards;
        }

        @keyframes wordIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 0.9;
            transform: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .planet {
            animation: none;
            offset-distance: 50%;
          }
          #orbit-splash {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
