import { CUSTOM_EVENTS } from "@/common/constants/events";
import type { FrontendMinionMetadata } from "@/common/types/minion";

export function isMinionForkSwitchEvent(
  event: Event
): event is CustomEvent<FrontendMinionMetadata> {
  return event.type === CUSTOM_EVENTS.MINION_FORK_SWITCH;
}

export function dispatchMinionSwitch(minionInfo: FrontendMinionMetadata): void {
  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENTS.MINION_FORK_SWITCH, {
      detail: minionInfo,
    })
  );
}
