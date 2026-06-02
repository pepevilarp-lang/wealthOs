'use client';

import { useEffect, useRef, useState } from 'react';

const PERIOD_MS = 2200;
const FAST_MIN_MS = 800;
const MAX_MS = 7000;
const EXIT_MS = 550;

export default function SplashScreen({
  ready,
  onDone,
}: {
  ready: boolean;
  onDone?: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  const startRef = useRef(0);
  const firedRef = useRef(false);
  const minRef = useRef(FAST_MIN_MS);

  // -------------------------
  // INIT (solo una vez)
  // -------------------------
  useEffect(() => {
    startRef.current = performance.now();

    let isFirstOpen = false;

    try {
      isFirstOpen = !localStorage.getItem('orbit_splash_seen');
      localStorage.setItem('orbit_splash_seen', '1');
    } catch {}

    minRef.current = isFirstOpen ? PERIOD_MS : FAST_MIN_MS;

    const safety = setTimeout(() => {
      beginLeave();
    }, MAX_MS);

    return () => clearTimeout(safety);
  }, []);

  // -------------------------
  // READY TRIGGER
  // -------------------------
  useEffect(() => {
    if (!ready) return;

    const elapsed = performance.now() - startRef.current;
    const wait = Math.max(0, minRef.current - elapsed);

    const t = setTimeout(() => {
      beginLeave();
    }, wait);

    return () => clearTimeout(t);
  }, [ready]);

  // -------------------------
  // EXIT CONTROLLED FLOW
  // -------------------------
  function beginLeave() {
    if (firedRef.current) return;
    firedRef.current = true;

    setLeaving(true);

    const finish = () => {
      onDone?.();
    };

    // fallback seguro (no dependemos del DOM)
    setTimeout(finish, EXIT_MS);
  }

  return (
    <div
      id="orbit-splash"
      aria-hidden="true"
      className={leaving ? 'leaving' : ''}
    >
      <div className="mark">
        <svg className="svg" viewBox="0 0 200 200" fill="none">
          <defs>
            <linearGradient id="orbit" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#1D4ED8" />
              <stop offset="0.5" stopColor="#2563EB" />
              <stop offset="1" stopColor="#60A5FA" />
            </linearGradient>

            <radialGradient id="ring" cx="0.5" cy="0.4" r="0.6">
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
              stroke="url(#orbit)"
              strokeWidth="2"
              opacity="0.8"
            />
          </g>

          <circle
            cx="100"
            cy="100"
            r="58"
            stroke="url(#ring)"
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
          transform: scale(1);
          transition: opacity 550ms ease, transform 550ms ease;
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
          animation: in 0.6s ease-out both;
        }

        @keyframes in {
          from {
            opacity: 0;
            transform: scale(0.7);
          }
          to {
            opacity: 1;
            transform: scale(1);
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

          offset-path: path(
            'M 12 100 A 88 32 0 1 1 188 100 A 88 32 0 1 1 12 100'
          );

          offset-distance: 0%;
          offset-rotate: 0deg;

          background: radial-gradient(
            circle at 30% 30%,
            #93c5fd,
            #2563eb 60%,
            #1e3a8a
          );

          box-shadow: 0 0 4px rgba(37, 99, 235, 0.25);

          animation: move 2200ms linear infinite,
            depth 2200ms ease-in-out infinite;

          will-change: offset-distance, transform;
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
          font-family: system-ui, sans-serif;
          font-size: 15px;
          letter-spacing: 0.45em;
          color: #e2e8f0;
          opacity: 0;
          animation: textIn 0.6s ease-out 0.2s forwards;
        }

        @keyframes textIn {
          to {
            opacity: 0.9;
            transform: translateY(0);
          }
          from {
            opacity: 0;
            transform: translateY(6px);
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
