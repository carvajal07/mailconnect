// invisibleChars.jsx — Render text with visible markers for whitespace characters
import './invisibleChars.css';

export function renderWithInvisibles(text) {
  if (!text) return null;
  const parts = [];
  let i = 0;
  for (const ch of text) {
    if (ch === ' ') {
      parts.push(<span key={i} className="inv inv--space">·</span>);
    } else if (ch === '\t') {
      parts.push(<span key={i} className="inv inv--tab">→{'\t'}</span>);
    } else if (ch === '\n') {
      parts.push(<span key={i} className="inv inv--para">¶</span>);
      parts.push(<br key={`br${i}`} />);
    } else {
      parts.push(ch);
    }
    i++;
  }
  // Trailing paragraph mark
  parts.push(<span key="end" className="inv inv--para">¶</span>);
  return parts;
}
