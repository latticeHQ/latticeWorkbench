/**
 * Sharing service — manage notebook sharing and collaborators.
 */

import type { BaseClient } from "../client/base";
import { RPC, ShareRoles, ShareAccessLevels } from "../client/constants";
import type { ShareStatus, Collaborator } from "../client/types";

export class SharingService {
  constructor(private readonly client: BaseClient) {}

  async getStatus(notebookId: string): Promise<ShareStatus> {
    const result = await this.client.rpcCall(RPC.GET_SHARE_STATUS, [notebookId]);

    if (!Array.isArray(result)) {
      return {
        isPublic: false,
        accessLevel: "restricted",
        collaborators: [],
        publicLink: null,
      };
    }

    const collaborators: Collaborator[] = [];
    if (Array.isArray(result[0])) {
      for (const c of result[0] as unknown[][]) {
        if (!Array.isArray(c)) continue;
        const roleCode = c[1] as number | undefined;
        collaborators.push({
          email: (c[0] as string) ?? "",
          role: roleCode != null ? ShareRoles.getName(roleCode) : "unknown",
          isPending: c[2] === true,
          displayName: (c[3] as string) ?? null,
        });
      }
    }

    const accessCode = result[1] as number | undefined;
    const isPublic = accessCode === ShareAccessLevels.getCode("public");

    return {
      isPublic,
      accessLevel: isPublic ? "public" : "restricted",
      collaborators,
      publicLink: isPublic ? `https://notebooklm.google.com/notebook/${notebookId}` : null,
    };
  }

  async togglePublicLink(notebookId: string, enabled: boolean): Promise<void> {
    const accessCode = enabled
      ? ShareAccessLevels.getCode("public")
      : ShareAccessLevels.getCode("restricted");

    await this.client.rpcCall(RPC.SHARE_NOTEBOOK, [
      notebookId, null, accessCode,
    ]);
  }

  async inviteCollaborator(
    notebookId: string,
    email: string,
    opts?: {
      role?: string;
      notify?: boolean;
      message?: string;
    },
  ): Promise<void> {
    const roleCode = opts?.role
      ? ShareRoles.getCode(opts.role)
      : ShareRoles.getCode("editor");

    await this.client.rpcCall(RPC.SHARE_NOTEBOOK, [
      notebookId,
      [[email, roleCode, opts?.notify !== false, opts?.message ?? null]],
    ]);
  }
}
