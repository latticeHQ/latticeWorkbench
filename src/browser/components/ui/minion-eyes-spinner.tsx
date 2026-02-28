import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/common/lib/utils";

/**
 * Animated Minion goggle-eyes spinner.
 *
 * Two stylized goggle-eyes that blink and look around — used as the
 * loading indicator throughout the app. Replaces the hexagon spinner
 * with the Minion brand identity.
 */
export function MinionEyesSpinner({
  className,
  size = 120,
}: {
  className?: string;
  size?: number;
}) {
  const shouldReduceMotion = useReducedMotion();

  // Scale factor relative to the 200x100 viewBox
  const width = size;
  const height = size * 0.5;

  if (shouldReduceMotion) {
    return (
      <div
        className={cn("minion-eyes-spinner", className)}
        style={{ width, height }}
        aria-hidden="true"
      >
        <StaticEyes width={width} height={height} />
      </div>
    );
  }

  return (
    <div
      className={cn("minion-eyes-spinner", className)}
      style={{ width, height }}
      aria-hidden="true"
    >
      <AnimatedEyes width={width} height={height} />
    </div>
  );
}

function StaticEyes({ width, height }: { width: number; height: number }) {
  return (
    <svg
      viewBox="0 0 200 100"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="mes-lens" cx="40%" cy="35%" r="60%">
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
        <circle cx="58" cy="43" r="22" fill="url(#mes-lens)" />
        <circle cx="52" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
      </g>
      <g>
        <circle cx="142" cy="43" r="28" fill="none" stroke="#9CA3AF" strokeWidth="4" />
        <circle cx="142" cy="43" r="26" fill="none" stroke="#6B7280" strokeWidth="1" />
        <circle cx="142" cy="43" r="22" fill="#F9FAFB" />
        <circle cx="142" cy="43" r="12" fill="#92700C" />
        <circle cx="142" cy="43" r="5.5" fill="#0C0F1A" />
        <circle cx="142" cy="43" r="22" fill="url(#mes-lens)" />
        <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
      </g>
    </svg>
  );
}

function AnimatedEyes({ width, height }: { width: number; height: number }) {
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
      viewBox="0 0 200 100"
      width={width}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="mes-lens" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.15} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </radialGradient>
        <clipPath id="mes-lid-l">
          <motion.rect
            x="30" y="15" width="56" height="56" rx="28"
            animate={lidKeyframes}
            transition={lidTransition(0)}
          />
        </clipPath>
        <clipPath id="mes-lid-r">
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
        <g clipPath="url(#mes-lid-l)">
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
          <circle cx="58" cy="43" r="22" fill="url(#mes-lens)" />
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
        <g clipPath="url(#mes-lid-r)">
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
          <circle cx="142" cy="43" r="22" fill="url(#mes-lens)" />
          <circle cx="136" cy="37" r="2.5" fill="#FFFFFF" opacity="0.8" />
        </g>
      </g>
    </svg>
  );
}
