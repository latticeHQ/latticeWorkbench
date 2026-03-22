import { CognitiveTickNode } from "./CognitiveTickNode";
import { GoalNode } from "./GoalNode";
import { WorkerNode } from "./WorkerNode";
import { EventNode } from "./EventNode";
import { ActionNode } from "./ActionNode";
import { MemoryNode } from "./MemoryNode";
import { IdentityNode } from "./IdentityNode";
import { MessageNode } from "./MessageNode";

export {
  CognitiveTickNode,
  GoalNode,
  WorkerNode,
  EventNode,
  ActionNode,
  MemoryNode,
  IdentityNode,
  MessageNode,
};

export const captainNodeTypes = {
  cognitiveTick: CognitiveTickNode,
  goal: GoalNode,
  worker: WorkerNode,
  event: EventNode,
  action: ActionNode,
  memory: MemoryNode,
  identity: IdentityNode,
  message: MessageNode,
};
