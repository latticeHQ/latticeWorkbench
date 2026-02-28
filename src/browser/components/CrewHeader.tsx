import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/common/lib/utils";
import { ChevronRight, Pencil, Trash2, Palette } from "lucide-react";
import type { CrewConfig } from "@/common/types/project";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { resolveCrewColor, CREW_COLOR_PALETTE } from "@/common/constants/ui";
import { HexColorPicker } from "react-colorful";

interface CrewHeaderProps {
  crew: CrewConfig;
  isExpanded: boolean;
  minionCount: number;
  onToggleExpand: () => void;
  onAddMinion: () => void;
  onRename: (name: string) => void;
  onChangeColor: (color: string) => void;
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const CrewHeader: React.FC<CrewHeaderProps> = ({
  crew,
  isExpanded,
  minionCount,
  onToggleExpand,
  onAddMinion,
  onRename,
  onChangeColor,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(crew.name);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hexInputValue, setHexInputValue] = useState(crew.color ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (showColorPicker) {
      const handleClickOutside = (e: MouseEvent) => {
        if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
          setShowColorPicker(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showColorPicker]);

  const handleSubmitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== crew.name) {
      onRename(trimmed);
    } else {
      setEditValue(crew.name);
    }
    setIsEditing(false);
  };

  const crewColor = resolveCrewColor(crew.color);

  // Sync hex input when color changes from picker or presets
  useEffect(() => {
    setHexInputValue(crewColor);
  }, [crewColor]);

  return (
    <div
      className="group relative flex items-center gap-1 border-t border-white/5 px-2 py-1.5"
      style={{
        backgroundColor: `${crewColor}10`,
        borderLeftWidth: 3,
        borderLeftColor: crewColor,
      }}
      data-crew-id={crew.id}
    >
      {/* Expand/Collapse Button */}
      <button
        onClick={onToggleExpand}
        className="text-secondary hover:text-foreground flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors"
        aria-label={isExpanded ? "Collapse crew" : "Expand crew"}
        aria-expanded={isExpanded}
      >
        <ChevronRight
          size={12}
          className="transition-transform duration-200"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Crew Name */}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmitRename();
            if (e.key === "Escape") {
              setEditValue(crew.name);
              setIsEditing(false);
            }
          }}
          data-testid="crew-rename-input"
          className="bg-background/50 text-foreground min-w-0 flex-1 rounded border border-white/20 px-1.5 py-0.5 text-xs font-medium outline-none"
        />
      ) : (
        <button
          onClick={onToggleExpand}
          onDoubleClick={() => setIsEditing(true)}
          className="text-foreground min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-xs font-medium"
        >
          {crew.name}
          <span className="text-muted ml-1.5 font-normal">({minionCount})</span>
        </button>
      )}

      {/* Action Buttons (visible on hover) */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Color Picker */}
        <div className="relative" ref={colorPickerRef}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="text-muted hover:text-foreground hover:bg-hover flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors"
                aria-label="Change color"
              >
                <Palette size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Change color</TooltipContent>
          </Tooltip>

          {showColorPicker && (
            <div className="bg-background border-border absolute top-full right-0 z-50 mt-1 rounded border p-2 shadow-lg">
              {/* Preset swatches */}
              <div className="mb-2 grid grid-cols-5 gap-1">
                {CREW_COLOR_PALETTE.map(([name, color]) => (
                  <button
                    key={color}
                    onClick={() => {
                      onChangeColor(color);
                      setShowColorPicker(false);
                    }}
                    className={cn(
                      "h-5 w-5 rounded border-2 transition-transform hover:scale-110",
                      crewColor === color ? "border-white" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                    title={name}
                    aria-label={`Set color to ${name}`}
                  />
                ))}
              </div>
              {/* Full color picker */}
              <div className="crew-color-picker">
                <HexColorPicker
                  color={crewColor}
                  onChange={(newColor) => onChangeColor(newColor)}
                />
              </div>
              {/* Hex input */}
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="text"
                  value={hexInputValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    setHexInputValue(value);
                    // Only apply valid hex colors
                    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                      onChangeColor(value);
                    }
                  }}
                  className="bg-background/50 text-foreground w-full rounded border border-white/20 px-1.5 py-0.5 text-xs outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Rename */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsEditing(true)}
              className="text-muted hover:text-foreground hover:bg-hover flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors"
              aria-label="Rename crew"
            >
              <Pencil size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>

        {/* Delete */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => onDelete(e)}
              className="text-muted hover:text-danger-light hover:bg-danger-light/10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 transition-colors"
              aria-label="Delete crew"
            >
              <Trash2 size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete crew</TooltipContent>
        </Tooltip>

        {/* Add Minion */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onAddMinion}
              className="text-secondary hover:text-foreground hover:bg-hover flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-sm transition-colors"
              aria-label="Summon minion in crew"
            >
              +
            </button>
          </TooltipTrigger>
          <TooltipContent>Summon minion</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
