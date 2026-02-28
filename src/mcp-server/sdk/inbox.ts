/**
 * Lattice SDK — Inbox operations (9 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

type Channel = "discord" | "googlechat" | "imessage" | "irc" | "signal" | "slack" | "telegram" | "whatsapp";

export async function listConversations(c: RouterClient<AppRouter>, projectPath: string, channel?: Channel) {
  return c.inbox.list({ projectPath, channel });
}

export async function getConversation(c: RouterClient<AppRouter>, projectPath: string, sessionKey: string) {
  return c.inbox.getConversation({ projectPath, sessionKey });
}

export async function sendReply(c: RouterClient<AppRouter>, projectPath: string, sessionKey: string, message: string) {
  return c.inbox.sendReply({ projectPath, sessionKey, message });
}

export async function updateStatus(
  c: RouterClient<AppRouter>,
  projectPath: string,
  sessionKey: string,
  status: "unread" | "processing" | "replied" | "errored" | "archived",
) {
  return c.inbox.updateStatus({ projectPath, sessionKey, status });
}

export async function connectionStatus(c: RouterClient<AppRouter>) {
  return c.inbox.connectionStatus();
}

export async function connectAdapter(c: RouterClient<AppRouter>, channel: Channel) {
  return c.inbox.connectAdapter({ channel });
}

export async function disconnectAdapter(c: RouterClient<AppRouter>, channel: Channel) {
  return c.inbox.disconnectAdapter({ channel });
}

export async function getChannelTokens(c: RouterClient<AppRouter>) {
  return c.inbox.getChannelTokens();
}

export async function setChannelToken(c: RouterClient<AppRouter>, channel: Channel, token?: string | null) {
  return c.inbox.setChannelToken({ channel, token });
}
