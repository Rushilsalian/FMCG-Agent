// Replies are spoken aloud, so strip anything a TTS engine would read badly.
export function toSpeakable(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) -> label
    .replace(/[*_`#>~]+/g, '') // markdown emphasis, code, headings, quotes
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '') // list bullets / numbering
    .replace(/\p{Extended_Pictographic}/gu, '') // emojis
    .replace(/\s+/g, ' ')
    .trim();
}
