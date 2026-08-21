// Models wrap JSON in prose or fenced code blocks more often than not (PRD §26 risk).
// Fenced-block extraction first, then first-brace-to-last-brace fallback, then bounded
// repair (the caller's job) rather than a silent parse failure.
export function extractJson(raw) {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }

  return null; // caller treats this as a SCHEMA_INVALID-shaped repair case
}
