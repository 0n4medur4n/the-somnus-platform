/** Same-browser tabs. Not storage: a message, then the channel is closed. */
export const CONSOLE_SESSION_CHANNEL = "somnus-console-session";

export type ConsoleSessionMessage = { kind: "console-session" };

/** Tell other open console tabs that this one just created a server session. */
export function announceConsoleSession(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CONSOLE_SESSION_CHANNEL);
  const message: ConsoleSessionMessage = { kind: "console-session" };
  channel.postMessage(message);
  channel.close();
}

/** Other tabs. The sender does not hear its own message. */
export function onConsoleSession(listener: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CONSOLE_SESSION_CHANNEL);
  const onMessage = (event: MessageEvent<ConsoleSessionMessage>) => {
    if (event.data?.kind === "console-session") listener();
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}
