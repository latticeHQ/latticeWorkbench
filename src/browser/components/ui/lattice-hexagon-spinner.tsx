import { cn } from "@/common/lib/utils";

/**
 * Animated Lattice hexagon logo spinner.
 *
 * A pulsing + rotating hexagon with the Lattice node-and-link motif.
 * Replaces the old Lottie dancing-blink animation with a native SVG/CSS
 * solution that matches the brand identity.
 */
export function LatticeHexagonSpinner({
  className,
  size = 120,
  color = "currentColor",
}: {
  className?: string;
  size?: number;
  color?: string;
}) {
  return (
    <div
      className={cn("lattice-hex-spinner", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 156 157"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        overflow="hidden"
        className="lattice-hex-spinner__svg"
      >
        {/* Hexagon outline */}
        <path
          d="M39 58.5 78 39 117 58.5 117 97.5 78 117 39 97.5Z"
          stroke={color}
          strokeWidth="2.4375"
          fill="none"
          className="lattice-hex-spinner__hex"
        />
        {/* Center node circle */}
        <circle
          cx="78"
          cy="78.5"
          r="4.875"
          stroke={color}
          strokeWidth="2.4375"
          fill="none"
          className="lattice-hex-spinner__node"
        />
        {/* Horizontal link line */}
        <line
          x1="58.5"
          y1="78.5"
          x2="97.5"
          y2="78.5"
          stroke={color}
          strokeWidth="2.4375"
          className="lattice-hex-spinner__link"
        />
      </svg>
    </div>
  );
}
