#!/usr/bin/env bun

import { parseArgs } from "util";
import { listMinionsCommand } from "./list-minions";
import { costsCommand } from "./costs";
import { sendMessageCommand } from "./send-message";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    minion: { type: "string", short: "w" },
    drop: { type: "string", short: "d" },
    limit: { type: "string", short: "l" },
    all: { type: "boolean", short: "a" },
    edit: { type: "string", short: "e" },
    message: { type: "string", short: "m" },
  },
  allowPositionals: true,
});

const command = positionals[0];

switch (command) {
  case "list-minions":
    listMinionsCommand();
    break;
  case "costs": {
    const minionId = positionals[1];
    if (!minionId) {
      console.error("Error: minion ID required");
      console.log("Usage: bun debug costs <minion-id>");
      process.exit(1);
    }
    console.profile("costs");
    await costsCommand(minionId);
    console.profileEnd("costs");
    break;
  }
  case "send-message": {
    const minionId = positionals[1];
    if (!minionId) {
      console.error("Error: minion ID required");
      console.log(
        "Usage: bun debug send-message <minion-id> [--edit <message-id>] [--message <text>]"
      );
      process.exit(1);
    }
    sendMessageCommand(minionId, values.edit, values.message);
    break;
  }
  default:
    console.log("Usage:");
    console.log("  bun debug list-minions");
    console.log("  bun debug costs <minion-id>");
    console.log("  bun debug send-message <minion-id> [--edit <message-id>] [--message <text>]");
    process.exit(1);
}
