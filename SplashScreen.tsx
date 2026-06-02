'use client';

/**
 * Orbit — SplashScreen (Next.js App Router, client component)
 * --------------------------------------------------------------
 * Premium launch overlay. Black bg, Orbit mark, planet orbiting the ring
 * (offset-path, GPU-composited, 60fps). First-ever open completes exactly
 * one full orbit before exiting; subsequent opens use an 800ms floor.
 * Never blocks artificially — fades out as soon as `ready` AND the floor are met.
 *
 * USAGE — wrap your authenticated boot in a client component:
 *
 *   'use client';
 *   import { useEffect, useState } from 'react';
 *   import SplashScreen from '@/components/SplashScreen';
 *
 *   export default function AppGate({ children }: { children: React.ReactNode }) {
 *     const [ready, setReady] = useState(false);
 *     const [done, setDone]   = useState(false);
 *     useEffect(() => {
 *       // load auth + session + user config + minimal data here…
 *       (async () => { await bootAuthAndSession(); setReady(true); })();
 *     }, []);
 *     return (
 *       <>
 *         {!done && <SplashScreen ready={ready} onDone={() => setDone(true)} />}
 *         {children}   // your Login or Dashboard — Next decides which to render
 *       </>
 *     );
 *   }
 */

import { useEffect, useRef, useState } from 'react';

const PERIOD_MS = 2200; // one full orbit — keep in sync with the CSS animation duration
const FAST_MIN_MS = 800; // floor for returning users (avoids flashes)
const MAX_MS = 7000; // safety cap — never trap the user behind the splash

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

  // First-open detection (client only) + start clock
  useEffect(() => {
    startRef.current = performance.now();
    let first = false;
    try {
      first = !localStorage.getItem('orbit_splash_seen');
      localStorage.setItem('orbit_splash_seen', '1');
    } catch {}
    minRef.current = first ? PERIOD_MS : FAST_MIN_MS;

    const cap = setTimeout(() => beginLeave(), MAX_MS); // safety
    return () => clearTimeout(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When data is ready, leave once the floor (or the one-orbit ritual) elapses
  useEffect(() => {
    if (!ready) return;
    const elapsed = performance.now() - startRef.current;
    const wait = Math.max(0, minRef.current - elapsed);
    const t = setTimeout(() => beginLeave(), wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function beginLeave() {
    if (firedRef.current) return;
    firedRef.current = true;
    setLeaving(true);
    // unmount after the fade transition (with fallback)
    const finish = () => onDone?.();
    const el = document.getElementById('orbit-splash');
    if (el) {
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 700);
    } else {
      setTimeout(finish, 600);
    }
  }

  return (
    <div
      id="orbit-splash"
      role="presentation"
      aria-hidden="true"
      className={leaving ? 'leaving' : ''}
    >
      <div className="mark">
        <svg className="svg" viewBox="0 0 200 200" fill="none">
          <defs>
            <linearGradient id="splOrbit" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#2f6bff" />
              <stop offset=".55" stopColor="#5b6cf0" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
            <radialGradient id="splRing" cx=".5" cy=".4" r=".62">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#cfd8ee" />
            </radialGradient>
          </defs>
          <g transform="rotate(-20 100 100)">
            <ellipse cx="100" cy="100" rx="88" ry="32" stroke="url(#splOrbit)" strokeWidth="3" opacity=".9" />
          </g>
          <circle cx="100" cy="100" r="58" stroke="url(#splRing)" strokeWidth="22" />
        </svg>
        <div className="planetOrbit"><div className="planet" /></div>
      </div>
      <div className="word">ORBIT</div>

      <style jsx>{`
        #orbit-splash {
          position: fixed; inset: 0; z-index: 100000; background: #000;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 30px; overflow: hidden; -webkit-tap-highlight-color: transparent;
          opacity: 1; transition: opacity .55s cubic-bezier(.4,0,.2,1), transform .55s cubic-bezier(.4,0,.2,1);
          will-change: opacity;
        }
        #orbit-splash::before {
          content: ""; position: absolute; width: 460px; height: 460px; border-radius: 50%;
          background: radial-gradient(circle, rgba(70,100,210,.12), rgba(70,100,210,0) 70%);
          filter: blur(18px); pointer-events: none;
        }
        #orbit-splash.leaving { opacity: 0; transform: scale(1.035); pointer-events: none; }
        .mark {
          position: relative; width: 200px; height: 200px; transform: scale(var(--s,.78));
          transform-origin: center; animation: markIn .7s cubic-bezier(.16,1,.3,1) both;
        }
        @keyframes markIn { from { opacity: 0; transform: scale(calc(var(--s,.78)*.9)); } to { opacity: 1; transform: scale(var(--s,.78)); } }
        .svg { position: absolute; inset: 0; width: 200px; height: 200px; overflow: visible;
          filter: drop-shadow(0 0 26px rgba(120,150,255,.16)); }
        .planetOrbit { position: absolute; inset: 0; width: 200px; height: 200px; transform: rotate(-20deg); }
        .planet {
          position: absolute; left: 0; top: 0; width: 25px; height: 25px; border-radius: 50%;
          offset-anchor: 50% 50%; offset-rotate: 0deg; offset-distance: 0%;
          offset-path: path("M 12 100 A 88 32 0 1 1 188 100 A 88 32 0 1 1 12 100");
          background: radial-gradient(circle at 34% 30%, #bcd6ff 0%, #4f8bff 46%, #1f49c4 100%);
          box-shadow: 0 0 12px rgba(79,139,255,.75), inset 0 0 3px rgba(255,255,255,.6);
          animation: planetMove ${PERIOD_MS}ms linear infinite, planetDepth ${PERIOD_MS}ms ease-in-out infinite;
          will-change: offset-distance, transform, opacity;
        }
        @keyframes planetMove { to { offset-distance: 100%; } }
        @keyframes planetDepth {
          0% { transform: scale(.95); opacity: .85; }
          25% { transform: scale(1.08); opacity: 1; }
          50% { transform: scale(.92); opacity: .8; }
          75% { transform: scale(.68); opacity: .48; }
          100% { transform: scale(.95); opacity: .85; }
        }
        .word {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
          font-weight: 500; font-size: 15px; letter-spacing: .46em; text-indent: .46em; color: #fff;
          opacity: 0; animation: wordIn .7s cubic-bezier(.16,1,.3,1) .22s forwards;
        }
        @keyframes wordIn { from { opacity: 0; transform: translateY(6px); } to { opacity: .92; transform: none; } }
        @supports not (offset-path: path("M0 0")) {
          .planet { offset-path: none; left: 50%; top: 6px; margin-left: -12.5px;
            transform-origin: 12.5px 94px; animation: planetSpin ${PERIOD_MS}ms linear infinite; }
          @keyframes planetSpin { to { transform: rotate(360deg); } }
        }
        @media (min-width: 768px) { .mark { --s: .9; } .word { font-size: 16px; } }
        @media (max-width: 380px) { .mark { --s: .62; } }
        @media (prefers-reduced-motion: reduce) {
          .mark, .word { animation-duration: .01ms !important; }
          .planet { animation: none; offset-distance: 8%; transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
