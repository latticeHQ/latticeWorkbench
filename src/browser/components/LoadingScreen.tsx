import { motion, AnimatePresence, useReducedMotion } from "motion/react";

/**
 * LoadingScreen — Minion eyes + Lattice hex assembly.
 *
 * Phase 2 of the boot sequence: React replaces the CSS-only boot-loader
 * with motion-powered SVG. Eyes continue blinking seamlessly, and the
 * Lattice hexagon logo draws itself below via pathLength animation.
 */
export function LoadingScreen(props: { statusText?: string }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className="boot-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="boot-loader__inner">
        {shouldReduceMotion ? <StaticMinionEyes /> : <AnimatedMinionEyes />}
        <HexAssembly reduced={!!shouldReduceMotion} />
        <StatusText text={props.statusText ?? "Loading minions..."} reduced={!!shouldReduceMotion} />
      </div>
    </div>
  );
}

/* ── Static eyes (reduced motion) ──────────────────────────────────── */
function StaticMinionEyes() {
  return (
    <svg
      className="boot-loader__eyes"
      viewBox="0 0 200 100"
      width={140}
      height={70}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ opacity: 1 }}
    >
      <defs>
        <radialGradient id="ls-lens" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x="82" y="38" width="36" height="10" rx="2" fill="#6B7280" />
      <g>
        <circle cx="58" cy="43" r="28" fill="none" stroke="#9CA3AF" strokeWidth="4" />
        <circle cx="58" cy="43" r="26" fill="none" stroke="#6B7280" strokeWidth="1" />
        <circle cx="58" cy="43" r="22" fill="#F9FAFB" />
        <circle cx="58" cy="43" r="12" fill="#92700C" />
        <circle cx="58" cy="43" r="5.5" fill="#0C0F1A" />
        <circle cx="58" cy="43" r="22" fill="url(#ls-lens)" />
        <circle cx="52" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
      </g>
      <g>
        <circle cx="142" cy="43" r="28" fill="none" stroke="#9CA3AF" strokeWidth="4" />
        <circle cx="142" cy="43" r="26" fill="none" stroke="#6B7280" strokeWidth="1" />
        <circle cx="142" cy="43" r="22" fill="#F9FAFB" />
        <circle cx="142" cy="43" r="12" fill="#92700C" />
        <circle cx="142" cy="43" r="5.5" fill="#0C0F1A" />
        <circle cx="142" cy="43" r="22" fill="url(#ls-lens)" />
        <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
      </g>
    </svg>
  );
}

/* ── Animated eyes (motion-powered) ────────────────────────────────── */
function AnimatedMinionEyes() {
  const lidKeyframes = { y: [0, 0, -56, 0, 0] };
  const lidTimes = [0, 0.89, 0.93, 0.97, 1];
  const lidTransition = (delay: number) => ({
    duration: 4,
    delay,
    repeat: Infinity,
    times: lidTimes,
    ease: "easeInOut" as const,
  });

  const leftPupilCx = [58, 60, 56.5, 59, 58];
  const leftPupilCy = [43, 42, 44, 42.5, 43];
  const rightPupilCx = [142, 144, 140.5, 143, 142];
  const rightPupilCy = [43, 42, 44, 42.5, 43];

  const leftIrisCx = [58, 59, 57.25, 58.5, 58];
  const leftIrisCy = [43, 42.5, 43.5, 42.75, 43];
  const rightIrisCx = [142, 143, 141.25, 142.5, 142];
  const rightIrisCy = [43, 42.5, 43.5, 42.75, 43];

  const pupilTransition = (delay: number) => ({
    duration: 3,
    delay,
    repeat: Infinity,
    ease: "easeInOut" as const,
  });

  const rimGlow = { stroke: ["#9CA3AF", "#D1D5DB", "#9CA3AF"] };
  const rimTransition = (delay: number) => ({
    duration: 2,
    delay,
    repeat: Infinity,
    ease: "easeInOut" as const,
  });

  return (
    <motion.svg
      className="boot-loader__eyes"
      viewBox="0 0 200 100"
      width={140}
      height={70}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
    >
      <defs>
        <radialGradient id="ls-lens" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <clipPath id="ls-lid-l">
          <motion.rect
            x="30" y="15" width="56" height="56" rx="28"
            animate={lidKeyframes}
            transition={lidTransition(0)}
          />
        </clipPath>
        <clipPath id="ls-lid-r">
          <motion.rect
            x="114" y="15" width="56" height="56" rx="28"
            animate={lidKeyframes}
            transition={lidTransition(0.3)}
          />
        </clipPath>
      </defs>

      {/* Strap */}
      <rect x="82" y="38" width="36" height="10" rx="2" fill="#6B7280" />

      {/* Left goggle */}
      <g>
        <motion.circle
          cx="58" cy="43" r="28" fill="none" strokeWidth="4"
          animate={rimGlow} transition={rimTransition(0)}
        />
        <circle cx="58" cy="43" r="26" fill="none" stroke="#6B7280" strokeWidth="1" />
        <g clipPath="url(#ls-lid-l)">
          <circle cx="58" cy="43" r="22" fill="#F9FAFB" />
          <motion.circle
            r="12" fill="#92700C"
            animate={{ cx: leftIrisCx, cy: leftIrisCy }}
            transition={pupilTransition(0)}
          />
          <motion.circle
            r="5.5" fill="#0C0F1A"
            animate={{ cx: leftPupilCx, cy: leftPupilCy }}
            transition={pupilTransition(0)}
          />
          <circle cx="58" cy="43" r="22" fill="url(#ls-lens)" />
          <circle cx="52" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
        </g>
      </g>

      {/* Right goggle */}
      <g>
        <motion.circle
          cx="142" cy="43" r="28" fill="none" strokeWidth="4"
          animate={rimGlow} transition={rimTransition(0.2)}
        />
        <circle cx="142" cy="43" r="26" fill="none" stroke="#6B7280" strokeWidth="1" />
        <g clipPath="url(#ls-lid-r)">
          <circle cx="142" cy="43" r="22" fill="#F9FAFB" />
          <motion.circle
            r="12" fill="#92700C"
            animate={{ cx: rightIrisCx, cy: rightIrisCy }}
            transition={pupilTransition(0.2)}
          />
          <motion.circle
            r="5.5" fill="#0C0F1A"
            animate={{ cx: rightPupilCx, cy: rightPupilCy }}
            transition={pupilTransition(0.2)}
          />
          <circle cx="142" cy="43" r="22" fill="url(#ls-lens)" />
          <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
        </g>
      </g>
    </motion.svg>
  );
}

/* ── Lattice hexagon assembly ──────────────────────────────────────── */
function HexAssembly({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={32}
        height={32}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ marginTop: 12, opacity: 0.5 }}
      >
        <path d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 12H17" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }

  return (
    <motion.svg
      viewBox="0 0 24 24"
      width={32}
      height={32}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ marginTop: 12 }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 0.5, scale: 1 }}
      transition={{ delay: 0.5, duration: 0.6, ease: "easeOut" }}
    >
      <motion.path
        d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.5, duration: 1.2, ease: "easeInOut" }}
      />
      <motion.circle
        cx="12" cy="12" r="2"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.4, ease: "easeOut" }}
      />
      <motion.path
        d="M7 12H17"
        stroke="currentColor"
        strokeWidth="1.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 1.0, duration: 0.5, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

/* ── Status text with crossfade ────────────────────────────────────── */
function StatusText({ text, reduced }: { text: string; reduced: boolean }) {
  if (reduced) {
    return <p className="boot-loader__text" style={{ opacity: 1 }}>{text}</p>;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={text}
        className="boot-loader__text"
        style={{ opacity: 1 }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.3 }}
      >
        {text}
      </motion.p>
    </AnimatePresence>
  );
}
