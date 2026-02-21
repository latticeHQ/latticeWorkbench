import { Settings } from "lucide-react";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { Button } from "@/browser/components/ui/button";
import { cn } from "@/common/lib/utils";

interface SettingsButtonProps {
  className?: string;
}

export function SettingsButton({ className }: SettingsButtonProps) {
  const { open, isOpen } = useSettings();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => open()}
      className={cn(
        "text-muted hover:text-foreground",
        isOpen && "text-foreground bg-hover",
        className
      )}
      aria-label="Open settings"
      data-testid="settings-button"
    >
      <Settings aria-hidden />
    </Button>
  );
}
