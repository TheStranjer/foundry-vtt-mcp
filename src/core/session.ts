import type { FoundryCredential } from "./credentials.js";

export interface JoinResponse {
  request: string;
  status: string;
  message: string;
  redirect?: string;
}

export function extractSessionIdFromCookies(cookies: string[] | undefined): string | null {
  if (!cookies) {
    return null;
  }

  for (const cookie of cookies) {
    const match = cookie.match(/session=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export function buildJoinPayload(credential: FoundryCredential): string {
  return JSON.stringify({
    userid: credential.userid,
    password: credential.password,
    action: "join",
  });
}

export function parseJoinResponse(
  statusCode: number | undefined,
  body: string
): { success: boolean; message?: string } {
  if (statusCode !== 200) {
    return { success: false };
  }

  try {
    const response = JSON.parse(body) as JoinResponse;
    if (response.status === "success") {
      return { success: true, message: response.message };
    }
  } catch {
    return { success: false };
  }

  return { success: false };
}
