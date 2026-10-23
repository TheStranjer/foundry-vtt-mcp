export interface FoundryCredential {
  _id: string;
  hostname: string;
  password: string;
  /** Foundry user document ID; looked up from `username` when omitted */
  userid?: string;
  /** Foundry username; looked up from `userid` when omitted. Required by v14 for /join */
  username?: string;
  allow_insecure_tls?: boolean;
}

export interface CredentialInfo {
  _id: string;
  hostname: string;
  userid?: string;
  username?: string;
  item_order: number;
  currently_active: boolean;
}

export function parseCredentials(raw: string): FoundryCredential[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Credentials JSON must be an array");
  }

  for (const credential of parsed) {
    if (
      typeof credential === "object" &&
      credential !== null &&
      "allow_insecure_tls" in credential &&
      typeof credential.allow_insecure_tls !== "boolean"
    ) {
      throw new Error("allow_insecure_tls must be a boolean");
    }

    const record = (credential ?? {}) as Record<string, unknown>;
    for (const field of ["userid", "username"]) {
      if (field in record && typeof record[field] !== "string") {
        throw new Error(`${field} must be a string`);
      }
    }
    if (!record.userid && !record.username) {
      throw new Error("Each credential needs a userid or a username");
    }
  }

  return parsed as FoundryCredential[];
}

export function getCredentialsInfo(
  credentials: FoundryCredential[],
  activeIndex: number
): CredentialInfo[] {
  return credentials.map((cred, index) => ({
    _id: cred._id,
    hostname: cred.hostname,
    userid: cred.userid,
    ...(cred.username ? { username: cred.username } : {}),
    item_order: index,
    currently_active: index === activeIndex,
  }));
}

export function resolveCredentialIndex(
  credentials: FoundryCredential[],
  identifier: { item_order?: number; _id?: string }
): number {
  if (identifier.item_order !== undefined) {
    if (identifier.item_order < 0 || identifier.item_order >= credentials.length) {
      throw new Error(
        `Invalid item_order: ${identifier.item_order}. Valid range is 0-${credentials.length - 1}`
      );
    }
    return identifier.item_order;
  }

  if (identifier._id !== undefined) {
    const index = credentials.findIndex((cred) => cred._id === identifier._id);
    if (index === -1) {
      const validIds = credentials.map((cred) => cred._id).join(", ");
      throw new Error(
        `No credential found with _id: "${identifier._id}". Valid _ids are: ${validIds}`
      );
    }
    return index;
  }

  throw new Error("Must provide either item_order or _id");
}
