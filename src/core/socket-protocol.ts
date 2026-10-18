export const WORLD_REQUEST_MESSAGE = '420["world"]';

/** Engine.IO ping frame (server -> client). */
export const ENGINE_PING = "2";
/** Engine.IO pong frame (client -> server) sent in reply to a ping. */
export const ENGINE_PONG = "3";

export function isEngineHandshake(message: string): boolean {
  return message.startsWith("0{");
}

export function isEnginePing(message: string): boolean {
  return message === ENGINE_PING;
}

export function isSessionEvent(message: string): boolean {
  return message.includes('["session",');
}

export interface SessionPayload {
  matched: boolean;
  sessionId: string | null;
  userId: string | null;
}

/**
 * Parse a Foundry `session` event: `42["session", <payload>]` where the payload
 * is either `null` (socket not bound to a user) or `{ sessionId, userId }`.
 * A non-null `sessionId` means the socket is bound and ready for data requests.
 */
export function parseSessionPayload(message: string): SessionPayload {
  const jsonStart = message.indexOf("[");
  if (jsonStart === -1) {
    return { matched: false, sessionId: null, userId: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.slice(jsonStart));
  } catch {
    return { matched: false, sessionId: null, userId: null };
  }

  if (!Array.isArray(parsed) || parsed[0] !== "session") {
    return { matched: false, sessionId: null, userId: null };
  }

  const payload = parsed[1];
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return {
      matched: true,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
      userId: typeof record.userId === "string" ? record.userId : null,
    };
  }

  // 42["session",null] — matched, but the socket was not bound to a user.
  return { matched: true, sessionId: null, userId: null };
}

export function parseWorldResponseMessage(message: string): {
  matched: boolean;
  data?: Record<string, unknown>;
  error?: Error;
} {
  if (!message.startsWith("430")) {
    return { matched: false };
  }

  try {
    const jsonPart = message.slice(3);
    const responseArray = JSON.parse(jsonPart) as unknown[];

    if (!Array.isArray(responseArray) || responseArray.length === 0) {
      return { matched: true, error: new Error("Invalid response format: expected array with data") };
    }

    const responseData = responseArray[0] as Record<string, unknown>;
    return { matched: true, data: responseData };
  } catch (error) {
    return {
      matched: true,
      error: new Error(`Failed to parse world response: ${error}`),
    };
  }
}

export function parseAckMessage(message: string): {
  matched: boolean;
  payload?: unknown[];
  error?: Error;
} {
  if (!message.startsWith("43")) {
    return { matched: false };
  }

  const jsonStart = message.indexOf("[");
  if (jsonStart === -1) {
    return { matched: true, error: new Error("Invalid ack format: missing JSON array") };
  }

  try {
    const jsonPart = message.slice(jsonStart);
    const responseArray = JSON.parse(jsonPart) as unknown[];

    if (!Array.isArray(responseArray) || responseArray.length === 0) {
      return { matched: true, error: new Error("Invalid ack format: empty payload") };
    }

    return { matched: true, payload: responseArray };
  } catch (error) {
    return { matched: true, error: new Error(`Failed to parse ack response: ${error}`) };
  }
}

/**
 * The ack id of a Socket.IO ack frame (`43<id>[...]`), or null when the frame carries none.
 * Requests are sent as `42<id>[...]` and Foundry answers with the same id, so a handler can
 * tell its own response from a concurrent request's response of the same document type.
 */
export function ackIdOf(message: string): number | null {
  const match = /^43(\d+)\[/.exec(message);
  return match ? Number(match[1]) : null;
}

export function buildModifyDocumentMessage(
  ackId: number,
  payload: unknown
): string {
  return `42${ackId}${JSON.stringify(payload)}`;
}
