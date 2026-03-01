import { MinionEyesSpinner } from "@/browser/components/ui/minion-eyes-spinner";
import { useTheme } from "@/browser/contexts/ThemeContext";
import { Shimmer } from "@/browser/components/ai-elements/shimmer";

interface CreationCenterContentProps {
  projectName: string;
  isSending: boolean;
  /** The confirmed minion name (null while generation is in progress) */
  minionName?: string | null;
  /** The confirmed minion title (null while generation is in progress) */
  minionTitle?: string | null;
}

/**
 * Loading overlay displayed during minion creation.
 * Shows the animated Lattice hexagon logo while the minion is being summoned.
 */
export function CreationCenterContent(props: CreationCenterContentProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark" || theme.endsWith("-dark");

  return (
    <>
      {props.isSending && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center pb-[30vh] ${isDark ? "bg-sidebar" : "bg-white"}`}
        >
          <MinionEyesSpinner size={140} />
          <div className="mt-8 max-w-xl px-8 text-center">
            <h2 className="text-foreground mb-2 text-2xl font-medium">Summoning minion</h2>
            <p className="text-muted text-sm leading-relaxed">
              {props.minionName ? (
                <>
                  <code className="bg-separator rounded px-1">{props.minionName}</code>
                  {props.minionTitle && (
                    <span className="text-muted-foreground ml-1">— {props.minionTitle}</span>
                  )}
                </>
              ) : (
                <Shimmer>Generating name…</Shimmer>
              )}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
