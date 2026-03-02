/**
 * AnimatedMinion — SVG minion with CSS-driven animations.
 *
 * Based on minion.svg reference. Animated elements:
 *   - Body: gentle breathing bob (translateY)
 *   - Pupils: idle drift, typing center-down, waiting look-up, done center
 *   - Eyelids: random blink interval
 *   - Mouth: expression changes per state
 *   - Arms: typing wiggle, done raised
 *   - Hair wisps: subtle sway
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/common/lib/utils";
import { darken } from "./sprites/colorUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MinionState = "idle" | "typing" | "done" | "waiting";

export interface AnimatedMinionProps {
  /** Crew color → overalls fill. */
  crewColor: string;
  /** Current behavioral state. */
  state: MinionState;
  /** Height in px (default 80). Width is auto from aspect ratio. */
  size?: number;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AnimatedMinion({
  crewColor,
  state,
  size = 80,
  className,
}: AnimatedMinionProps) {
  // Random blink
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 3500; // 2.5–6s
      blinkTimer.current = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 150);
      }, delay);
    };
    scheduleBlink();
    return () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    };
  }, []);

  const accentDark = useMemo(() => darken(crewColor, 18), [crewColor]);

  // Pupil offsets per state
  const pupilOffset = {
    idle: { cx: 0, cy: 0 },      // CSS animation handles drift
    typing: { cx: 0, cy: 3 },    // looking down at keyboard
    done: { cx: 0, cy: 0 },      // center, happy
    waiting: { cx: 0, cy: -3 },  // looking up
  }[state];

  // Mouth path per state
  const mouthPath = {
    idle: "M 85 110 Q 100 120 115 110",           // gentle smile
    typing: "M 90 112 Q 100 116 110 112",         // focused "o" shape
    done: "M 82 108 Q 100 128 118 108",           // big grin
    waiting: "M 88 112 L 112 112",                // flat/neutral
  }[state];

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ height: size, width: size * (200 / 300) }}
    >
      {/* Inline keyframes */}
      <style>{`
        @keyframes minion-breathe {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(1.5px); }
        }
        @keyframes minion-idle-wander {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          20% { transform: translateX(4px) rotate(1.5deg); }
          50% { transform: translateX(-2px) rotate(-0.5deg); }
          80% { transform: translateX(-5px) rotate(-1.5deg); }
        }
        @keyframes minion-typing-bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-1px) rotate(-0.5deg); }
          75% { transform: translateY(1px) rotate(0.5deg); }
        }
        @keyframes minion-pupil-drift {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(4px); }
          75% { transform: translateX(-4px); }
        }
        @keyframes minion-hair-sway {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes minion-type-arm-l {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(-4deg); }
        }
        @keyframes minion-type-arm-r {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(4deg); }
        }
        @keyframes minion-idle-arm-swing {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes minion-done-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .minion-breathe {
          animation: minion-breathe 3s ease-in-out infinite;
        }
        .minion-idle-wander {
          animation: minion-idle-wander 5s ease-in-out infinite;
        }
        .minion-typing-bob {
          animation: minion-typing-bob 1.2s ease-in-out infinite;
        }
        .minion-done-bounce {
          animation: minion-done-bounce 1s ease-in-out infinite;
        }
        .minion-pupil-drift {
          animation: minion-pupil-drift 3.5s ease-in-out infinite;
        }
        .minion-hair-sway {
          animation: minion-hair-sway 3s ease-in-out infinite;
          transform-origin: 100px 42px;
        }
        .minion-type-arm-l {
          animation: minion-type-arm-l 0.3s ease-in-out infinite alternate;
          transform-origin: 45px 140px;
        }
        .minion-type-arm-r {
          animation: minion-type-arm-r 0.3s ease-in-out infinite alternate;
          transform-origin: 155px 140px;
        }
        .minion-idle-arm-l {
          animation: minion-idle-arm-swing 3s ease-in-out infinite;
          transform-origin: 45px 140px;
        }
        .minion-idle-arm-r {
          animation: minion-idle-arm-swing 3s ease-in-out infinite reverse;
          transform-origin: 155px 140px;
        }
      `}</style>

      <svg
        viewBox="0 0 200 300"
        width="100%"
        height="100%"
        className="block"
      >
        {/* ── Body group (state-driven motion + breathing) ── */}
        <g className={
          state === "idle" ? "minion-idle-wander" :
          state === "typing" ? "minion-typing-bob" :
          state === "done" ? "minion-done-bounce" :
          "minion-breathe"
        }>
          {/* Yellow pill body */}
          <rect x="50" y="40" width="100" height="170" rx="50" fill="#FFD700" />

          {/* Body shadow edges */}
          <rect x="50" y="40" width="8" height="170" rx="4" fill="#E6C200" opacity="0.4" />
          <rect x="142" y="40" width="8" height="170" rx="4" fill="#E6C200" opacity="0.4" />

          {/* ── Overalls ── */}
          <path d="M50 150 v 30 a 50 50 0 0 0 100 0 v -30 z" fill={crewColor} />
          <rect x="70" y="120" width="60" height="40" fill={crewColor} />

          {/* Suspender straps */}
          <path d="M45 105 L 75 125" stroke={crewColor} strokeWidth="8" strokeLinecap="round" />
          <path d="M155 105 L 125 125" stroke={crewColor} strokeWidth="8" strokeLinecap="round" />

          {/* Suspender buttons */}
          <circle cx="72" cy="125" r="4" fill={accentDark} />
          <circle cx="128" cy="125" r="4" fill={accentDark} />

          {/* Pocket on overalls */}
          <rect x="85" y="142" width="30" height="18" rx="3" fill="none" stroke={accentDark} strokeWidth="1.5" opacity="0.5" />

          {/* ── Arms ── */}
          <g className={
            state === "typing" ? "minion-type-arm-l" :
            state === "idle" ? "minion-idle-arm-l" : undefined
          }>
            <path
              d={state === "done"
                ? "M45 140 Q 20 100 30 75"   // arms up!
                : "M45 140 Q 25 170 35 190"  // normal hang
              }
              stroke="#FFD700" strokeWidth="10" strokeLinecap="round" fill="none"
              style={{ transition: "d 0.4s ease" }}
            />
            <circle
              cx={state === "done" ? 30 : 36}
              cy={state === "done" ? 73 : 192}
              r="8" fill="#333"
              style={{ transition: "cx 0.4s ease, cy 0.4s ease" }}
            />
          </g>
          <g className={
            state === "typing" ? "minion-type-arm-r" :
            state === "idle" ? "minion-idle-arm-r" : undefined
          }>
            <path
              d={state === "done"
                ? "M155 140 Q 180 100 170 75" // arms up!
                : "M155 140 Q 175 170 165 190" // normal hang
              }
              stroke="#FFD700" strokeWidth="10" strokeLinecap="round" fill="none"
              style={{ transition: "d 0.4s ease" }}
            />
            <circle
              cx={state === "done" ? 170 : 164}
              cy={state === "done" ? 73 : 192}
              r="8" fill="#333"
              style={{ transition: "cx 0.4s ease, cy 0.4s ease" }}
            />
          </g>

          {/* ── Legs & Shoes ── */}
          <rect x="75" y="210" width="14" height="25" fill={crewColor} />
          <rect x="111" y="210" width="14" height="25" fill={crewColor} />
          <ellipse cx="82" cy="235" rx="16" ry="8" fill="#222" />
          <ellipse cx="118" cy="235" rx="16" ry="8" fill="#222" />

          {/* ── Goggle strap ── */}
          <rect x="45" y="75" width="110" height="14" fill="#333" rx="2" />

          {/* ── Goggles ── */}
          <circle cx="78" cy="82" r="20" fill="#fff" stroke="#999" strokeWidth="6" />
          <circle cx="122" cy="82" r="20" fill="#fff" stroke="#999" strokeWidth="6" />

          {/* ── Pupils ── */}
          <g
            className={state === "idle" ? "minion-pupil-drift" : undefined}
            style={state !== "idle" ? { transform: `translate(${pupilOffset.cx}px, ${pupilOffset.cy}px)` } : undefined}
          >
            {/* Left eye */}
            <circle cx="82" cy="82" r="6" fill="#654321" />
            <circle cx="82" cy="82" r="2" fill="#000" />
            {/* Right eye */}
            <circle cx="118" cy="82" r="6" fill="#654321" />
            <circle cx="118" cy="82" r="2" fill="#000" />
          </g>

          {/* ── Eyelids (blink) ── */}
          {blinking && (
            <>
              <rect x="62" y="66" width="32" height="32" rx="16" fill="#FFD700" />
              <rect x="106" y="66" width="32" height="32" rx="16" fill="#FFD700" />
            </>
          )}

          {/* ── Mouth ── */}
          <path
            d={mouthPath}
            stroke="#333"
            strokeWidth="2"
            fill={state === "done" ? "#fff" : "none"}
            strokeLinecap="round"
            style={{ transition: "d 0.3s ease" }}
          />

          {/* ── Hair wisps ── */}
          <g className="minion-hair-sway">
            <path d="M 95 42 Q 90 20 85 15" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M 100 40 Q 100 20 100 10" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M 105 42 Q 110 20 115 15" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </div>
  );
}
