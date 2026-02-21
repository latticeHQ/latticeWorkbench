import * as React from "react";
import { cn } from "@/common/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border-medium bg-transparent px-3 py-2 text-sm text-foreground",
          "placeholder:text-muted",
          "focus-visible:outline-none focus-visible:border-border-darker focus-visible:ring-1 focus-visible:ring-border-medium",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors duration-150",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
