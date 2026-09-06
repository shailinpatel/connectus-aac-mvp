import pack from "./voice-pack.json";

type Recording = { text: string; src: string; duration: number };
export const voicePack = pack;
const clips: Record<string, Recording> = pack.clips;
export function recordingFor(text: string): Recording | null {
  return clips[text.trim().replace(/\s+/g, " ").toLowerCase()] || null;
}
