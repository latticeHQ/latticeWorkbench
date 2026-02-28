import React from "react";
import type { TokenConsumer } from "@/common/types/chatStats";
import { Tooltip, TooltipTrigger, TooltipContent, HelpIndicator } from "../ui/tooltip";

// Format token display - show k for thousands with 1 decimal
const formatTokens = (tokens: number) =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens.toLocaleString();

// Distinct colors for each consumer bar — cycles through 8 hues
const CONSUMER_COLORS = [
  "var(--color-accent)",         // orange — brand
  "var(--color-ask-mode)",       // blue
  "var(--color-exec-mode)",      // teal
  "var(--color-plan-mode)",      // violet
  "var(--color-edit-mode)",      // amber
  "var(--color-task-mode)",      // emerald
  "var(--color-debug-mode)",     // rose
  "var(--color-thinking-mode)",  // indigo
] as const;

interface ConsumerBreakdownProps {
  consumers: TokenConsumer[];
  totalTokens: number;
}

const ConsumerBreakdownComponent: React.FC<ConsumerBreakdownProps> = ({
  consumers,
  totalTokens,
}) => {
  if (consumers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {consumers.map((consumer, index) => {
        // Calculate percentages for fixed and variable segments
        const fixedPercentage = consumer.fixedTokens
          ? (consumer.fixedTokens / totalTokens) * 100
          : 0;
        const variablePercentage = consumer.variableTokens
          ? (consumer.variableTokens / totalTokens) * 100
          : 0;

        // Each consumer gets a unique color from the palette
        const barColor = CONSUMER_COLORS[index % CONSUMER_COLORS.length];

        return (
          <div key={consumer.name} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-foreground flex items-center gap-1 text-xs font-medium">
                {consumer.name}
                {consumer.name === "web_search" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpIndicator>?</HelpIndicator>
                    </TooltipTrigger>
                    <TooltipContent align="center" className="max-w-80 whitespace-normal">
                      Web search results are encrypted and decrypted server-side. This estimate is
                      approximate.
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
              <span className="text-muted text-[11px]">
                {formatTokens(consumer.tokens)} ({consumer.percentage.toFixed(1)}%)
              </span>
            </div>
            <div className="bg-hover flex h-1.5 w-full overflow-hidden rounded">
              {consumer.fixedTokens && consumer.variableTokens ? (
                <>
                  <div
                    className="h-full transition-[width] duration-300"
                    style={{ width: `${fixedPercentage}%`, background: barColor, opacity: 0.55 }}
                  />
                  <div
                    className="h-full transition-[width] duration-300"
                    style={{ width: `${variablePercentage}%`, background: barColor }}
                  />
                </>
              ) : (
                <div
                  className="h-full transition-[width] duration-300"
                  style={{ width: `${consumer.percentage}%`, background: barColor }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Memoize to prevent re-renders when parent re-renders but consumers data hasn't changed
// Only re-renders when consumers object reference changes (when store bumps it)
export const ConsumerBreakdown = React.memo(ConsumerBreakdownComponent);
