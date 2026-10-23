// user-identity.ts
// A credential may name its Foundry user by document ID (`userid`), by name
// (`username`), or both. /join wants both on v14, so a missing half is filled
// in from the user list Foundry hands any unauthenticated socket via the
// `getJoinData` event (the same list the join screen's user picker shows).

import type { FoundryCredential } from "./credentials.js";

export interface JoinUser {
  id: string;
  name: string;
}

export function hasCompleteUserIdentity(credential: FoundryCredential): boolean {
  return Boolean(credential.userid) && Boolean(credential.username);
}

export function buildJoinDataRequestMessage(ackId: number): string {
  return `42${ackId}["getJoinData"]`;
}

/**
 * Extract the users from a `getJoinData` ack payload (`[{ users: [...] , ...}]`).
 * Entries without a string id and name are skipped.
 */
export function parseJoinDataUsers(payload: unknown[]): JoinUser[] {
  const data = payload[0];
  if (!data || typeof data !== "object") {
    throw new Error("Invalid join data: expected an object");
  }

  const users = (data as Record<string, unknown>).users;
  if (!Array.isArray(users)) {
    throw new Error("Invalid join data: missing users array");
  }

  return users.flatMap((user) => {
    if (!user || typeof user !== "object") {
      return [];
    }
    const record = user as Record<string, unknown>;
    const id = typeof record._id === "string" ? record._id : record.id;
    if (typeof id !== "string" || typeof record.name !== "string") {
      return [];
    }
    return [{ id, name: record.name }];
  });
}

/**
 * Fill in whichever of `userid` / `username` the credential lacks from the
 * world's user list. A credential that already has both is returned unchanged.
 */
export function resolveUserIdentity(
  credential: FoundryCredential,
  users: JoinUser[]
): FoundryCredential {
  if (hasCompleteUserIdentity(credential)) {
    return credential;
  }

  if (credential.userid) {
    const user = users.find((candidate) => candidate.id === credential.userid);
    if (!user) {
      throw new Error(`No Foundry user found with userid: "${credential.userid}"`);
    }
    return { ...credential, username: user.name };
  }

  if (credential.username) {
    const user = findUserByName(users, credential.username);
    return { ...credential, userid: user.id };
  }

  throw new Error("Credential must have a userid or a username");
}

function findUserByName(users: JoinUser[], username: string): JoinUser {
  const exact = users.filter((user) => user.name === username);
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    throw new Error(`Multiple Foundry users are named "${username}"; set userid instead`);
  }

  const lowered = username.toLowerCase();
  const loose = users.filter((user) => user.name.toLowerCase() === lowered);
  if (loose.length === 1) {
    return loose[0];
  }
  if (loose.length > 1) {
    throw new Error(`Multiple Foundry users match "${username}" ignoring case; set userid instead`);
  }

  throw new Error(`No Foundry user found with username: "${username}"`);
}
