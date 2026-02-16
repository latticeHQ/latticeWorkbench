import React from "react";
import { useFileOpener } from "@/browser/contexts/FileOpenerContext";
import { FileIcon } from "@/browser/components/FileIcon";

interface ClickableFilePathProps {
  filePath: string;
  /** Show the file icon before the path (default: true) */
  showIcon?: boolean;
  className?: string;
}

/**
 * Renders a file path as a clickable element that opens the file in the sidebar viewer.
 * Uses FileOpenerContext to bridge chat-pane tool components with the right sidebar.
 */
export const ClickableFilePath: React.FC<ClickableFilePathProps> = ({
  filePath,
  showIcon = true,
  className,
}) => {
  const { openFile } = useFileOpener();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger parent expand/collapse
    if (filePath) {
      openFile(filePath);
    }
  };

  return (
    <span className={`inline-flex max-w-96 min-w-0 items-center gap-1.5 ${className ?? ""}`}>
      {showIcon && (
        <FileIcon filePath={filePath} className="text-[15px] leading-none flex-shrink-0" />
      )}
      <span
        onClick={handleClick}
        className="font-monospace truncate cursor-pointer hover:underline hover:text-accent transition-colors"
        title={`Open ${filePath}`}
      >
        {filePath}
      </span>
    </span>
  );
};
