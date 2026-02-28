import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { useMinionRecency } from "@/browser/stores/MinionStore";
import { useStableReference, compareMaps } from "@/browser/hooks/useStableReference";

export function useSortedMinionsByProject() {
  const { projects } = useProjectContext();
  const { minionMetadata } = useMinionContext();
  const minionRecency = useMinionRecency();

  return useStableReference(
    () => {
      const result = new Map<string, FrontendMinionMetadata[]>();
      for (const [projectPath, config] of projects) {
        const metadataList = config.minions
          .map((ws) => (ws.id ? minionMetadata.get(ws.id) : undefined))
          .filter((meta): meta is FrontendMinionMetadata => Boolean(meta));

        metadataList.sort((a, b) => {
          const aTimestamp = minionRecency[a.id] ?? 0;
          const bTimestamp = minionRecency[b.id] ?? 0;
          return bTimestamp - aTimestamp;
        });

        result.set(projectPath, metadataList);
      }
      return result;
    },
    (prev, next) =>
      compareMaps(prev, next, (a, b) => {
        if (a.length !== b.length) {
          return false;
        }
        return a.every((metadata, index) => {
          const other = b[index];
          if (!other) {
            return false;
          }
          return metadata.id === other.id && metadata.name === other.name;
        });
      }),
    [projects, minionMetadata, minionRecency]
  );
}
