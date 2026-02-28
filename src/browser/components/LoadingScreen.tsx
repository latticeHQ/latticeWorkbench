import { motion, AnimatePresence, useReducedMotion } from "motion/react";

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
        {!shouldReduceMotion && <HexAssembly />}
        <StatusText
          text={props.statusText ?? "Loading minions..."}
          reducedMotion={!!shouldReduceMotion}
        />
      </div>
    </div>
  );
}

/** Static eyes for prefers-reduced-motion — eyes shown open, no animation */
function StaticMinionEyes() {
  return (
    <svg
      className="boot-loader__eyes"
      viewBox="0 0 200 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="bl-lens" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x="82" y="38" width="36" height="10" rx="2" fill="#6B7280" />
      {/* Left goggle */}
      <g>
        <circle
          cx="58"
          cy="43"
          r="28"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth="4"
        />
        <circle
          cx="58"
          cy="43"
          r="26"
          fill="none"
          stroke="#6B7280"
          strokeWidth="1"
        />
        <circle cx="58" cy="43" r="22" fill="#F9FAFB" />
        <circle cx="58" cy="43" r="12" fill="#92700C" />
        <circle cx="58" cy="43" r="5.5" fill="#0C0F1A" />
        <circle cx="58" cy="43" r="22" fill="url(#bl-lens)" />
        <circle cx="52" cy="37" r="2.5" fill="#FFFFFF" opacity="0.7" />
      </g>
      {/* Right goggle */}
      <g>
        <circle
          cx="142"
          cy="43"
          r="28"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth="4"
        />
        <circle
          cx="142"
          cy="43"
          r="26"
          fill="none"
          stroke="#6B7280"
          strokeWidth="1"
        />
        <circle cx="142" cy="43" r="22" fill="#F9FAFB" />
        <circle cx="142" cy="43" r="12" fill="#92700C" />
        <circle cx="142" cy="43" r="5.5" fill="#0C0F1A" />
        <circle cx="142" cy="43" r="22" fill="url(#bl-lens)" />
        <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.7" />
      </g>
    </svg>
  );
}

/** Animated eyes with motion-powered pupil tracking, eyelid blinks, and rim glow */
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
    <svg
      className="boot-loader__eyes"
      viewBox="0 0 200 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="bl-lens" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <clipPath id="bl-lid-l">
          <motion.rect
            x="30"
            y="15"
            width="56"
            height="56"
            rx="28"
            animate={lidKeyframes}
            transition={lidTransition(0)}
          />
        </clipPath>
        <clipPath id="bl-lid-r">
          <motion.rect
            x="114"
            y="15"
            width="56"
            height="56"
            rx="28"
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
          cx="58"
          cy="43"
          r="28"
          fill="none"
          strokeWidth="4"
          animate={rimGlow}
          transition={rimTransition(0)}
        />
        <circle
          cx="58"
          cy="43"
          r="26"
          fill="none"
          stroke="#6B7280"
          strokeWidth="1"
        />
        <g clipPath="url(#bl-lid-l)">
          <circle cx="58" cy="43" r="22" fill="#F9FAFB" />
          <motion.circle
            r="12"
            fill="#92700C"
            animate={{ cx: leftIrisCx, cy: leftIrisCy }}
            transition={pupilTransition(0)}
          />
          <motion.circle
            r="5.5"
            fill="#0C0F1A"
            animate={{ cx: leftPupilCx, cy: leftPupilCy }}
            transition={pupilTransition(0)}
          />
          <circle cx="58" cy="43" r="22" fill="url(#bl-lens)" />
          <circle cx="52" cy="37" r="2.5" fill="#FFFFFF" opacity="0.7" />
        </g>
      </g>

      {/* Right goggle */}
      <g>
        <motion.circle
          cx="142"
          cy="43"
          r="28"
          fill="none"
          strokeWidth="4"
          animate={rimGlow}
          transition={rimTransition(0.2)}
        />
        <circle
          cx="142"
          cy="43"
          r="26"
          fill="none"
          stroke="#6B7280"
          strokeWidth="1"
        />
        <g clipPath="url(#bl-lid-r)">
          <circle cx="142" cy="43" r="22" fill="#F9FAFB" />
          <motion.circle
            r="12"
            fill="#92700C"
            animate={{ cx: rightIrisCx, cy: rightIrisCy }}
            transition={pupilTransition(0.2)}
          />
          <motion.circle
            r="5.5"
            fill="#0C0F1A"
            animate={{ cx: rightPupilCx, cy: rightPupilCy }}
            transition={pupilTransition(0.2)}
          />
          <circle cx="142" cy="43" r="22" fill="url(#bl-lens)" />
          <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.7" />
        </g>
      </g>
    </svg>
  );
}

/** Hexagon that draws itself below the eyes — Lattice brand callback */
function HexAssembly() {
  return (
    <motion.svg
      viewBox="0 0 156 157"
      width="40"
      height="40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5, duration: 0.6, ease: "easeOut" }}
    >
      <motion.path
        d="M39 58.5 78 39 117 58.5 117 97.5 78 117 39 97.5Z"
        stroke="currentColor"
        strokeWidth="2.4375"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.5, duration: 1.2, ease: "easeInOut" }}
      />
      <motion.circle
        cx="78"
        cy="78.5"
        r="4.875"
        stroke="currentColor"
        strokeWidth="2.4375"
        fill="none"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      />
      <motion.line
        x1="58.5"
        y1="78.5"
        x2="97.5"
        y2="78.5"
        stroke="currentColor"
        strokeWidth="2.4375"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 1.4, duration: 0.4, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

/** Status text with AnimatePresence crossfade on text changes */
function StatusText({
  text,
  reducedMotion,
}: {
  text: string;
  reducedMotion: boolean;
}) {
  if (reducedMotion) {
    return (
      <p className="boot-loader__text" style={{ opacity: 1 }}>
        {text}
      </p>
    );
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
