/**
 * PixelHQContextMenu — Context menus for the Pixel HQ control panel.
 *
 * Shows different action menus based on what entity was right-clicked:
 * - Character → View Chat, Stop, Archive, Reassign Crew
 * - Empty desk → New Minion Here
 * - Crew section → New Minion, Rename, Color
 * - Empty floor → New Crew, New Minion
 */

import { useCallback } from "react";
import {
  MessageSquare,
  Square,
  Archive,
  ArrowRightLeft,
  Plus,
  Palette,
  Pencil,
  Copy,
  HelpCircle,
} from "lucide-react";
import {
  PositionedMenu,
  PositionedMenuItem,
} from "@/browser/components/ui/positioned-menu";
import type { Character, RoomDefinition, Seat } from "@/browser/utils/pixelHQ/engine/types";
import type { ContextMenuPosition } from "@/browser/hooks/useContextMenuPosition";
import type { CrewConfig } from "@/common/types/project";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type HQContextTarget =
  | { kind: "character"; character: Character }
  | { kind: "empty_desk"; seat: Seat; section: RoomDefinition | null }
  | { kind: "section"; section: RoomDefinition }
  | { kind: "floor" }
  | null;

export interface HQContextMenuActions {
  onViewChat: (minionId: string) => void;
  onStopStream: (minionId: string) => void;
  onArchive: (minionId: string) => void;
  onUnarchive: (minionId: string) => void;
  onReassignCrew: (minionId: string, crewId: string | null) => void;
  onAnswerQuestion: (minionId: string) => void;
  onCopyId: (minionId: string) => void;
  onNewMinion: (crewId?: string) => void;
  onNewCrew: () => void;
  onRenameCrew: (crewId: string) => void;
  onChangeCrewColor: (crewId: string) => void;
}

interface PixelHQContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: ContextMenuPosition | null;
  target: HQContextTarget;
  actions: HQContextMenuActions;
  crews: CrewConfig[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PixelHQContextMenu({
  open,
  onOpenChange,
  position,
  target,
  actions,
  crews,
}: PixelHQContextMenuProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  if (!target) return null;

  return (
    <PositionedMenu
      open={open}
      onOpenChange={onOpenChange}
      position={position}
      className="w-[200px]"
    >
      {target.kind === "character" && (
        <CharacterMenu
          character={target.character}
          actions={actions}
          crews={crews}
          close={close}
        />
      )}
      {target.kind === "empty_desk" && (
        <EmptyDeskMenu
          section={target.section}
          actions={actions}
          close={close}
        />
      )}
      {target.kind === "section" && (
        <SectionMenu
          section={target.section}
          actions={actions}
          close={close}
        />
      )}
      {target.kind === "floor" && (
        <FloorMenu actions={actions} close={close} />
      )}
    </PositionedMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-menus
// ─────────────────────────────────────────────────────────────────────────────

function CharacterMenu({
  character,
  actions,
  crews,
  close,
}: {
  character: Character;
  actions: HQContextMenuActions;
  crews: CrewConfig[];
  close: () => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted truncate border-b border-border-light mb-1">
        {character.displayName}
      </div>

      <PositionedMenuItem
        icon={<MessageSquare size={14} />}
        label="View Chat"
        onClick={() => {
          actions.onViewChat(character.minionId);
          close();
        }}
      />

      {character.isActive && (
        <PositionedMenuItem
          icon={<Square size={14} />}
          label="Stop Stream"
          onClick={() => {
            actions.onStopStream(character.minionId);
            close();
          }}
        />
      )}

      {character.bubbleType === "waiting" && (
        <PositionedMenuItem
          icon={<HelpCircle size={14} />}
          label="Answer Question"
          onClick={() => {
            actions.onAnswerQuestion(character.minionId);
            close();
          }}
        />
      )}

      <PositionedMenuItem
        icon={<Archive size={14} />}
        label="Archive"
        onClick={() => {
          actions.onArchive(character.minionId);
          close();
        }}
      />

      {/* Crew reassignment submenu — shown inline */}
      {crews.length > 0 && (
        <>
          <div className="px-2 py-1 text-[10px] font-medium text-muted uppercase tracking-wide mt-1">
            Reassign to Crew
          </div>
          {crews.map((crew) => (
            <PositionedMenuItem
              key={crew.id}
              icon={
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: crew.color ?? "#6B7280" }}
                />
              }
              label={crew.name}
              onClick={() => {
                actions.onReassignCrew(character.minionId, crew.id);
                close();
              }}
            />
          ))}
          <PositionedMenuItem
            icon={<ArrowRightLeft size={14} />}
            label="Unassign from Crew"
            onClick={() => {
              actions.onReassignCrew(character.minionId, null);
              close();
            }}
          />
        </>
      )}

      <div className="border-t border-border-light mt-1 pt-1">
        <PositionedMenuItem
          icon={<Copy size={14} />}
          label="Copy Minion ID"
          onClick={() => {
            actions.onCopyId(character.minionId);
            close();
          }}
        />
      </div>
    </>
  );
}

function EmptyDeskMenu({
  section,
  actions,
  close,
}: {
  section: RoomDefinition | null;
  actions: HQContextMenuActions;
  close: () => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted border-b border-border-light mb-1">
        Empty Desk
      </div>
      <PositionedMenuItem
        icon={<Plus size={14} />}
        label="New Minion Here"
        onClick={() => {
          actions.onNewMinion(section?.crewId ?? undefined);
          close();
        }}
      />
    </>
  );
}

function SectionMenu({
  section,
  actions,
  close,
}: {
  section: RoomDefinition;
  actions: HQContextMenuActions;
  close: () => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted truncate border-b border-border-light mb-1">
        {section.label}
      </div>
      <PositionedMenuItem
        icon={<Plus size={14} />}
        label="New Minion"
        onClick={() => {
          actions.onNewMinion(section.crewId ?? undefined);
          close();
        }}
      />
      {section.crewId && (
        <>
          <PositionedMenuItem
            icon={<Pencil size={14} />}
            label="Rename Crew"
            onClick={() => {
              actions.onRenameCrew(section.crewId!);
              close();
            }}
          />
          <PositionedMenuItem
            icon={<Palette size={14} />}
            label="Change Color"
            onClick={() => {
              actions.onChangeCrewColor(section.crewId!);
              close();
            }}
          />
        </>
      )}
    </>
  );
}

function FloorMenu({
  actions,
  close,
}: {
  actions: HQContextMenuActions;
  close: () => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted border-b border-border-light mb-1">
        Office Floor
      </div>
      <PositionedMenuItem
        icon={<Plus size={14} />}
        label="New Crew"
        onClick={() => {
          actions.onNewCrew();
          close();
        }}
      />
      <PositionedMenuItem
        icon={<Plus size={14} />}
        label="New Minion"
        onClick={() => {
          actions.onNewMinion();
          close();
        }}
      />
    </>
  );
}
