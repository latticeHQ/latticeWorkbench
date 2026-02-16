import React, { createContext, useContext } from "react";

interface FileOpenerContextType {
  openFile: (relativePath: string) => void;
}

const FileOpenerContext = createContext<FileOpenerContextType>({
  openFile: () => {}, // no-op default
});

interface FileOpenerProviderProps {
  openFile: (relativePath: string) => void;
  children: React.ReactNode;
}

export const FileOpenerProvider: React.FC<FileOpenerProviderProps> = ({ openFile, children }) => {
  const value = React.useMemo(() => ({ openFile }), [openFile]);
  return <FileOpenerContext.Provider value={value}>{children}</FileOpenerContext.Provider>;
};

export function useFileOpener(): FileOpenerContextType {
  return useContext(FileOpenerContext);
}
