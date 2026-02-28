import React, { useState, useEffect, useRef, useCallback } from "react";
import { Archive, Loader2 } from "lucide-react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { useAPI } from "@/browser/contexts/API";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { isMinionArchived } from "@/common/utils/archive";
import { BenchedMinions } from "../../BenchedMinions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/ui/select";

/**
 * Settings crew for viewing and managing archived minions.
 * Shows a project picker (when multiple projects exist) and the
 * BenchedMinions card for the selected project.
 */
export const ArchivedSection: React.FC = () => {
  const { api } = useAPI();
  const { projects } = useProjectContext();
  const projectPaths = Array.from(projects.keys());

  const [selectedProject, setSelectedProject] = useState<string>(
    () => projectPaths[0] ?? ""
  );
  const [archivedMinions, setBenchedMinions] = useState<
    FrontendMinionMetadata[]
  >([]);
  const [loading, setLoading] = useState(true);
  const archivedMapRef = useRef<Map<string, FrontendMinionMetadata>>(
    new Map()
  );

  const syncState = useCallback(() => {
    setBenchedMinions(Array.from(archivedMapRef.current.values()));
  }, []);

  // Load archived minions when project changes
  useEffect(() => {
    if (!api || !selectedProject) {
      setBenchedMinions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    void api.minion.list({ archived: true }).then((all) => {
      if (cancelled) return;
      const filtered = all.filter((w) => w.projectPath === selectedProject);
      archivedMapRef.current = new Map(filtered.map((w) => [w.id, w]));
      syncState();
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [api, selectedProject, syncState]);

  // Subscribe to real-time archive/unarchive events
  useEffect(() => {
    if (!api || !selectedProject) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const iterator = await api.minion.onMetadata(undefined, {
          signal: controller.signal,
        });
        for await (const event of iterator) {
          if (controller.signal.aborted) break;
          const meta = event.metadata;
          if (meta && meta.projectPath !== selectedProject) continue;
          if (!meta && !archivedMapRef.current.has(event.minionId)) continue;

          if (meta && isMinionArchived(meta.archivedAt, meta.unarchivedAt)) {
            archivedMapRef.current.set(meta.id, meta);
          } else {
            archivedMapRef.current.delete(event.minionId);
          }
          syncState();
        }
      } catch {
        // Stream aborted or failed — non-critical
      }
    })();

    return () => controller.abort();
  }, [api, selectedProject, syncState]);

  const projectName = selectedProject
    ? selectedProject.split("/").pop() ?? selectedProject
    : "";

  return (
    <div className="flex flex-col gap-4">
      {/* Project picker — only shown when multiple projects exist */}
      {projectPaths.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-muted text-sm shrink-0">Project</span>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectPaths.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.split("/").pop() ?? p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <Loader2 className="text-muted h-4 w-4 animate-spin" />
          <span className="text-muted text-sm">Loading benched minions…</span>
        </div>
      ) : !selectedProject ? (
        <div className="flex items-center gap-3 py-8 justify-center">
          <Archive className="text-muted h-4 w-4" />
          <span className="text-muted text-sm">No project selected</span>
        </div>
      ) : archivedMinions.length === 0 ? (
        <div className="border-border rounded-lg border">
          <div className="flex items-center gap-3 px-4 py-3">
            <Archive className="text-muted h-4 w-4" />
            <span className="text-muted text-sm">
              No benched minions in {projectName}
            </span>
          </div>
        </div>
      ) : (
        <BenchedMinions
          projectPath={selectedProject}
          projectName={projectName}
          minions={archivedMinions}
          onMinionsChanged={() => {
            if (!api) return;
            void api.minion.list({ archived: true }).then((all) => {
              const filtered = all.filter(
                (w) => w.projectPath === selectedProject
              );
              archivedMapRef.current = new Map(
                filtered.map((w) => [w.id, w])
              );
              syncState();
            });
          }}
        />
      )}
    </div>
  );
};
