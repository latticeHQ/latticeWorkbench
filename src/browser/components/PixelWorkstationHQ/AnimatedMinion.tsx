/**
 * AnimatedMinion — SVG minion with CSS-driven animations.
 *
 * Thought cloud is rendered as an HTML element ABOVE the SVG so text is
 * readable at real pixel sizes (SVG viewBox compression makes SVG text tiny).
 * Cloud uses theme CSS variables and Tailwind classes for light/dark support.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/common/lib/utils";
import { darken } from "./sprites/colorUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MinionState = "idle" | "thinking" | "typing" | "done" | "waiting";

export interface AnimatedMinionProps {
  crewColor: string;
  state: MinionState;
  size?: number;
  className?: string;
  /** Primary label inside cloud — e.g. "Thinking" or "Streaming" */
  cloudLabel?: string;
  /** Secondary snippet — e.g. tool name, file path, token count */
  cloudSnippet?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thought cloud — pure HTML/CSS bubble
// ─────────────────────────────────────────────────────────────────────────────

function ThoughtBubble({
  label,
  snippet,
  isThinking,
}: {
  label: string;
  snippet: string | null;
  isThinking: boolean;
}) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+4px)] z-30 pointer-events-none animate-[cloud-float_3s_ease-in-out_infinite]">
      {/* Trail dots — ascending from minion head */}
      <div className="flex flex-col items-center">
        {/* Main bubble */}
        <div
          className={cn(
            "relative rounded-[20px] px-4 py-2.5 min-w-[140px] max-w-[220px]",
            "border border-border/50 bg-background/95 backdrop-blur-sm",
            "shadow-sm shadow-black/5",
          )}
        >
          {/* Label row */}
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-[12px] font-semibold text-foreground/50 tracking-wide">
              {label}
            </span>
            {isThinking && (
              <span className="flex items-center gap-[3px]">
                <span className="h-[5px] w-[5px] rounded-full bg-foreground/30 animate-[dot-bounce_1.4s_ease-in-out_infinite]" />
                <span className="h-[5px] w-[5px] rounded-full bg-foreground/30 animate-[dot-bounce_1.4s_ease-in-out_0.2s_infinite]" />
                <span className="h-[5px] w-[5px] rounded-full bg-foreground/30 animate-[dot-bounce_1.4s_ease-in-out_0.4s_infinite]" />
              </span>
            )}
          </div>

          {/* Streaming code lines */}
          {!isThinking && (
            <div className="flex flex-col gap-[3px] mt-1.5 mx-1">
              <div className="h-[3px] rounded-full bg-foreground/15 animate-[line-grow_2s_ease-out_infinite] w-[60%]" />
              <div className="h-[3px] rounded-full bg-foreground/12 animate-[line-grow_2s_ease-out_0.3s_infinite] w-[85%]" />
              <div className="h-[3px] rounded-full bg-foreground/15 animate-[line-grow_2s_ease-out_0.6s_infinite] w-[50%]" />
              <div className="h-[3px] rounded-full bg-foreground/10 animate-[line-grow_2s_ease-out_0.9s_infinite] w-[72%]" />
            </div>
          )}

          {/* Snippet */}
          {snippet && (
            <div className="mt-1.5 text-center">
              <span className="text-[10px] font-mono text-muted/60 truncate block">
                {snippet}
              </span>
            </div>
          )}

          {/* Tail pointer — three descending circles */}
          <div className="absolute left-1/2 top-full flex flex-col items-center -translate-x-1/2">
            <div className="w-[10px] h-[10px] rounded-full bg-background/95 border border-border/50 -mt-[5px]" />
            <div className="w-[7px] h-[7px] rounded-full bg-background/95 border border-border/50 mt-[2px]" />
            <div className="w-[4px] h-[4px] rounded-full bg-background/95 border border-border/50 mt-[2px]" />
          </div>
        </div>
      </div>

      {/* Keyframes injected once */}
      <style>{`
        @keyframes cloud-float {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(-3px); }
        }
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes line-grow {
          0% { transform: scaleX(0); opacity: 0; transform-origin: left; }
          30% { transform: scaleX(1); opacity: 1; }
          100% { transform: scaleX(0.5); opacity: 0.1; transform-origin: left; }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function AnimatedMinion({
  crewColor,
  state,
  size = 80,
  className,
  cloudLabel,
  cloudSnippet,
}: AnimatedMinionProps) {
  const [blinking, setBlinking] = useState(false);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 3500;
      blinkTimer.current = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => { setBlinking(false); scheduleBlink(); }, 150);
      }, delay);
    };
    scheduleBlink();
    return () => { if (blinkTimer.current) clearTimeout(blinkTimer.current); };
  }, []);

  const accentDark = useMemo(() => darken(crewColor, 18), [crewColor]);
  const showCloud = state === "thinking" || state === "typing";

  // Both thinking & typing get the "pondering" expression since both are live/working
  const pupilOffset = {
    idle: { cx: 0, cy: 0 },
    thinking: { cx: -2, cy: -4 },
    typing: { cx: -2, cy: -4 },
    done: { cx: 0, cy: 0 },
    waiting: { cx: 0, cy: -3 },
  }[state];

  const mouthPath = {
    idle: "M 85 110 Q 100 120 115 110",
    thinking: "M 88 114 Q 100 110 112 114",
    typing: "M 88 114 Q 100 110 112 114",
    done: "M 82 108 Q 100 128 118 108",
    waiting: "M 88 112 L 112 112",
  }[state];

  const label = cloudLabel ?? (state === "thinking" ? "Thinking" : "Streaming");
  const snippet = cloudSnippet
    ? (cloudSnippet.length > 32 ? cloudSnippet.slice(0, 30) + ".." : cloudSnippet)
    : null;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ height: size, width: size * (200 / 300) }}
    >
      {/* ── HTML thought cloud (above SVG, real pixel sizes) ── */}
      {showCloud && (
        <ThoughtBubble
          label={label}
          snippet={snippet}
          isThinking={state === "thinking"}
        />
      )}

      {/* SVG keyframes */}
      <style>{`
        @keyframes m-breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(1.5px)} }
        @keyframes m-idle { 0%,100%{transform:translateX(0) rotate(0)} 20%{transform:translateX(4px) rotate(1.5deg)} 50%{transform:translateX(-2px) rotate(-.5deg)} 80%{transform:translateX(-5px) rotate(-1.5deg)} }
        @keyframes m-type { 0%,100%{transform:translateY(0) rotate(0)} 25%{transform:translateY(-1px) rotate(-.5deg)} 75%{transform:translateY(1px) rotate(.5deg)} }
        @keyframes m-think { 0%,100%{transform:translateX(0) rotate(0)} 30%{transform:translateX(2px) rotate(1deg)} 70%{transform:translateX(-2px) rotate(-1deg)} }
        @keyframes m-done { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes m-pupil { 0%,100%{transform:translateX(0)} 25%{transform:translateX(4px)} 75%{transform:translateX(-4px)} }
        @keyframes m-hair { 0%,100%{transform:rotate(0)} 50%{transform:rotate(3deg)} }
        @keyframes m-arm-l { 0%,100%{transform:rotate(0)} 50%{transform:rotate(-4deg)} }
        @keyframes m-arm-r { 0%,100%{transform:rotate(0)} 50%{transform:rotate(4deg)} }
        @keyframes m-arm-sw { 0%,100%{transform:rotate(0)} 50%{transform:rotate(3deg)} }
        @keyframes m-chin { 0%,100%{transform:rotate(0)} 50%{transform:rotate(-2deg)} }
        .m-breathe{animation:m-breathe 3s ease-in-out infinite}
        .m-idle{animation:m-idle 5s ease-in-out infinite}
        .m-type{animation:m-type 1.2s ease-in-out infinite}
        .m-think{animation:m-think 2.5s ease-in-out infinite}
        .m-chin{animation:m-chin 2.5s ease-in-out infinite;transform-origin:155px 140px}
        .m-done{animation:m-done 1s ease-in-out infinite}
        .m-pupil{animation:m-pupil 3.5s ease-in-out infinite}
        .m-hair{animation:m-hair 3s ease-in-out infinite;transform-origin:100px 42px}
        .m-al{animation:m-arm-l .3s ease-in-out infinite alternate;transform-origin:45px 140px}
        .m-ar{animation:m-arm-r .3s ease-in-out infinite alternate;transform-origin:155px 140px}
        .m-asl{animation:m-arm-sw 3s ease-in-out infinite;transform-origin:45px 140px}
        .m-asr{animation:m-arm-sw 3s ease-in-out infinite reverse;transform-origin:155px 140px}
      `}</style>

      <svg
        viewBox="0 0 200 300"
        width="100%"
        height="100%"
        className="block"
      >
        {/* ── Body group ── */}
        <g className={
          state === "idle" ? "m-idle" :
          state === "thinking" ? "m-think" :
          state === "typing" ? "m-think" :
          state === "done" ? "m-done" :
          "m-breathe"
        }>
          <rect x="50" y="40" width="100" height="170" rx="50" fill="#FFD700" />
          <rect x="50" y="40" width="8" height="170" rx="4" fill="#E6C200" opacity="0.4" />
          <rect x="142" y="40" width="8" height="170" rx="4" fill="#E6C200" opacity="0.4" />

          {/* Overalls */}
          <path d="M50 150 v 30 a 50 50 0 0 0 100 0 v -30 z" fill={crewColor} />
          <rect x="70" y="120" width="60" height="40" fill={crewColor} />
          <path d="M45 105 L 75 125" stroke={crewColor} strokeWidth="8" strokeLinecap="round" />
          <path d="M155 105 L 125 125" stroke={crewColor} strokeWidth="8" strokeLinecap="round" />
          <circle cx="72" cy="125" r="4" fill={accentDark} />
          <circle cx="128" cy="125" r="4" fill={accentDark} />
          <rect x="85" y="142" width="30" height="18" rx="3" fill="none" stroke={accentDark} strokeWidth="1.5" opacity="0.5" />

          {/* Left arm */}
          <g className={state === "idle" ? "m-asl" : undefined}>
            <path
              d={state === "done" ? "M45 140 Q 20 100 30 75"
                : (state === "thinking" || state === "typing") ? "M45 140 Q 60 158 88 155"
                : "M45 140 Q 25 170 35 190"}
              stroke="#FFD700" strokeWidth="10" strokeLinecap="round" fill="none"
              style={{ transition: "d 0.4s ease" }}
            />
            <circle
              cx={state === "done" ? 30 : (state === "thinking" || state === "typing") ? 90 : 36}
              cy={state === "done" ? 73 : (state === "thinking" || state === "typing") ? 155 : 192}
              r="8" fill="#333" style={{ transition: "cx .4s,cy .4s" }}
            />
          </g>
          {/* Right arm */}
          <g className={state === "idle" ? "m-asr" : undefined}>
            <path
              d={state === "done" ? "M155 140 Q 180 100 170 75"
                : (state === "thinking" || state === "typing") ? "M155 140 Q 140 158 112 155"
                : "M155 140 Q 175 170 165 190"}
              stroke="#FFD700" strokeWidth="10" strokeLinecap="round" fill="none"
              style={{ transition: "d 0.4s ease" }}
            />
            <circle
              cx={state === "done" ? 170 : (state === "thinking" || state === "typing") ? 110 : 164}
              cy={state === "done" ? 73 : (state === "thinking" || state === "typing") ? 155 : 192}
              r="8" fill="#333" style={{ transition: "cx .4s,cy .4s" }}
            />
          </g>

          {/* Legs & shoes */}
          <rect x="75" y="210" width="14" height="25" fill={crewColor} />
          <rect x="111" y="210" width="14" height="25" fill={crewColor} />
          <ellipse cx="82" cy="235" rx="16" ry="8" fill="#222" />
          <ellipse cx="118" cy="235" rx="16" ry="8" fill="#222" />

          {/* Goggle strap */}
          <rect x="45" y="75" width="110" height="14" fill="#333" rx="2" />

          {/* Goggles */}
          <circle cx="78" cy="82" r="20" fill="#fff" stroke="#999" strokeWidth="6" />
          <circle cx="122" cy="82" r="20" fill="#fff" stroke="#999" strokeWidth="6" />

          {/* Pupils */}
          <g
            className={state === "idle" ? "m-pupil" : undefined}
            style={state !== "idle" ? { transform: `translate(${pupilOffset.cx}px,${pupilOffset.cy}px)` } : undefined}
          >
            <circle cx="82" cy="82" r="6" fill="#654321" />
            <circle cx="82" cy="82" r="2" fill="#000" />
            <circle cx="118" cy="82" r="6" fill="#654321" />
            <circle cx="118" cy="82" r="2" fill="#000" />
          </g>

          {/* Blink */}
          {blinking && (
            <>
              <rect x="62" y="66" width="32" height="32" rx="16" fill="#FFD700" />
              <rect x="106" y="66" width="32" height="32" rx="16" fill="#FFD700" />
            </>
          )}

          {/* Mouth */}
          <path
            d={mouthPath} stroke="#333" strokeWidth="2"
            fill={state === "done" ? "#fff" : "none"}
            strokeLinecap="round" style={{ transition: "d .3s" }}
          />

          {/* Hair */}
          <g className="m-hair">
            <path d="M 95 42 Q 90 20 85 15" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M 100 40 Q 100 20 100 10" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M 105 42 Q 110 20 115 15" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </div>
  );
}
