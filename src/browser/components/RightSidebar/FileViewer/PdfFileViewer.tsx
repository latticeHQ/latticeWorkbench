/**
 * PdfFileViewer - Displays PDF files using the browser's built-in PDF viewer.
 * Uses an <iframe> with a data URL, which Chromium (Electron) renders natively.
 */

import React from "react";
import { FileText } from "lucide-react";

interface PdfFileViewerProps {
  base64: string;
  size: number;
  filePath: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PdfFileViewer: React.FC<PdfFileViewerProps> = ({ base64, size, filePath }) => {
  const dataUrl = React.useMemo(() => {
    return `data:application/pdf;base64,${base64}`;
  }, [base64]);

  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-border-light flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <FileText className="text-muted h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-monospace text-text truncate" title={filePath}>
          {fileName}
        </span>
        <span className="text-secondary ml-auto whitespace-nowrap">{formatBytes(size)}</span>
      </div>
      {/* PDF iframe */}
      <iframe
        src={dataUrl}
        className="flex-1 border-0 bg-white"
        title={`PDF: ${fileName}`}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
