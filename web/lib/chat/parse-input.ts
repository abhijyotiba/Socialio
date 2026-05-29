// Pulls the first URL out of free text. The remainder (URL stripped, trimmed)
// is the user's angle/instruction. No URL → the whole text is the angle.
export function parseInput(text: string): { url: string | null; angle: string } {
  const match = text.match(/https?:\/\/[^\s]+/);
  if (!match) return { url: null, angle: text.trim() };
  const url = match[0];
  const angle = text.replace(url, "").trim();
  return { url, angle };
}
