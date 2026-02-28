import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "@/browser/contexts/RouterContext";

interface OpenSettingsOptions {
  /** When opening the Providers settings, expand the given provider. */
  expandProvider?: string;
  /** When opening the Runtimes settings, pre-select this project scope. */
  runtimesProjectPath?: string;
}

interface SettingsContextValue {
  isOpen: boolean;
  activeSection: string;
  open: (section?: string, options?: OpenSettingsOptions) => void;
  close: () => void;
  setActiveSection: (section: string) => void;

  /** Subscribe to settings close events. Returns an unsubscribe function. */
  registerOnClose: (callback: () => void) => () => void;

  /** One-shot hint for ProvidersSection to expand a provider. */
  providersExpandedProvider: string | null;
  setProvidersExpandedProvider: (provider: string | null) => void;

  /** One-shot hint for RuntimesSection to pre-select a project scope. */
  runtimesProjectPath: string | null;
  setRuntimesProjectPath: (path: string | null) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

const DEFAULT_SECTION = "general";

export function SettingsProvider(props: { children: ReactNode }) {
  const router = useRouter();
  const [providersExpandedProvider, setProvidersExpandedProvider] = useState<string | null>(null);
  const [runtimesProjectPath, setRuntimesProjectPath] = useState<string | null>(null);

  const closeCallbacksRef = useRef(new Set<() => void>());

  const isOpen = router.currentSettingsSection != null;
  const activeSection = router.currentSettingsSection ?? DEFAULT_SECTION;

  const open = useCallback(
    (section?: string, options?: OpenSettingsOptions) => {
      const nextSection = section ?? DEFAULT_SECTION;
      if (nextSection === "providers") {
        setProvidersExpandedProvider(options?.expandProvider ?? null);
      } else {
        setProvidersExpandedProvider(null);
      }
      if (nextSection === "runtimes") {
        setRuntimesProjectPath(options?.runtimesProjectPath ?? null);
      } else {
        setRuntimesProjectPath(null);
      }
      router.navigateToSettings(nextSection);
    },
    [router]
  );

  const registerOnClose = useCallback((callback: () => void) => {
    closeCallbacksRef.current.add(callback);
    return () => {
      closeCallbacksRef.current.delete(callback);
    };
  }, []);

  // Fire close subscribers whenever settings transitions from open → closed,
  // regardless of how the navigation happened (explicit close, back button, etc.).
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      setProvidersExpandedProvider(null);
      setRuntimesProjectPath(null);
      for (const callback of closeCallbacksRef.current) {
        callback();
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const close = useCallback(() => {
    setProvidersExpandedProvider(null);
    setRuntimesProjectPath(null);
    router.navigateFromSettings();
  }, [router]);

  const setActiveSection = useCallback(
    (section: string) => {
      if (section !== "providers") {
        setProvidersExpandedProvider(null);
      }
      if (section !== "runtimes") {
        // Runtime scope hints are one-shot and should not persist across crew changes.
        setRuntimesProjectPath(null);
      }
      router.navigateToSettings(section);
    },
    [router]
  );

  // Listen for custom events dispatched by decoupled components (e.g. the
  // terminal profile "+" dropdown's "Manage Profiles..." button) that need
  // to open a specific settings crew without importing this context.
  useEffect(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent<{ section: string }>).detail?.section;
      if (section) open(section);
    };
    window.addEventListener("lattice:open-settings", handler);
    return () => window.removeEventListener("lattice:open-settings", handler);
  }, [open]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      isOpen,
      activeSection,
      open,
      close,
      setActiveSection,
      registerOnClose,
      providersExpandedProvider,
      setProvidersExpandedProvider,
      runtimesProjectPath,
      setRuntimesProjectPath,
    }),
    [
      isOpen,
      activeSection,
      open,
      close,
      setActiveSection,
      registerOnClose,
      providersExpandedProvider,
      runtimesProjectPath,
    ]
  );

  return <SettingsContext.Provider value={value}>{props.children}</SettingsContext.Provider>;
}
