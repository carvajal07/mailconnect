// src/nodes/ScriptProcessor/config/ScriptEditor.jsx
// Code editor: textarea + regex highlight + type-aware Ctrl+Space autocomplete.
//
// Triggers:
//   Ctrl+Space              — full list filtered by word under cursor
//   packet.                 — upstream field paths
//   packet.{path}.          — prototype methods for that field's type
//                             (object/array → sub-fields instead of methods)
//   helpers.                — helper function names

import { useRef, useCallback, useMemo, useState } from 'react';
import { helpers as HELPERS_OBJ } from '../engine/scriptHelpers.js';

// ── Static suggestion data ────────────────────────────────────────────────────

const HELPER_METHODS = Object.keys(HELPERS_OBJ);

const TYPE_METHODS = {
  string: [
    { m: 'toUpperCase()',          d: '→ string'         },
    { m: 'toLowerCase()',          d: '→ string'         },
    { m: 'trim()',                 d: '→ string'         },
    { m: 'trimStart()',            d: '→ string'         },
    { m: 'trimEnd()',              d: '→ string'         },
    { m: 'split(separator)',       d: '→ array'          },
    { m: 'replace(from, to)',      d: '→ string'         },
    { m: 'replaceAll(from, to)',   d: '→ string'         },
    { m: 'includes(str)',          d: '→ boolean'        },
    { m: 'startsWith(str)',        d: '→ boolean'        },
    { m: 'endsWith(str)',          d: '→ boolean'        },
    { m: 'slice(start, end)',      d: '→ string'         },
    { m: 'indexOf(str)',           d: '→ number'         },
    { m: 'padStart(len, char)',    d: '→ string'         },
    { m: 'padEnd(len, char)',      d: '→ string'         },
    { m: 'repeat(n)',              d: '→ string'         },
    { m: 'match(regex)',           d: '→ array|null'     },
    { m: 'length',                 d: 'number (prop)'    },
    { m: 'charAt(i)',              d: '→ string'         },
    { m: 'toString()',             d: '→ string'         },
  ],
  number: [
    { m: 'toFixed(digits)',        d: '→ string'         },
    { m: 'toString()',             d: '→ string'         },
    { m: 'toLocaleString(locale)', d: '→ string'         },
    { m: 'toPrecision(digits)',    d: '→ string'         },
  ],
  integer: [
    { m: 'toFixed(digits)',        d: '→ string'         },
    { m: 'toString()',             d: '→ string'         },
    { m: 'toLocaleString(locale)', d: '→ string'         },
  ],
  boolean: [
    { m: 'toString()',             d: '→ string'         },
  ],
  array: [
    { m: 'length',                 d: 'number (prop)'    },
    { m: 'map(fn)',                d: '→ array'          },
    { m: 'filter(fn)',             d: '→ array'          },
    { m: 'find(fn)',               d: '→ item|undefined' },
    { m: 'findIndex(fn)',          d: '→ number'         },
    { m: 'reduce(fn, init)',       d: '→ any'            },
    { m: 'some(fn)',               d: '→ boolean'        },
    { m: 'every(fn)',              d: '→ boolean'        },
    { m: 'includes(item)',         d: '→ boolean'        },
    { m: 'indexOf(item)',          d: '→ number'         },
    { m: 'join(sep)',              d: '→ string'         },
    { m: 'slice(start, end)',      d: '→ array'          },
    { m: 'concat(...items)',       d: '→ array'          },
    { m: 'flat(depth)',            d: '→ array'          },
    { m: 'flatMap(fn)',            d: '→ array'          },
    { m: 'sort(fn)',               d: '→ array'          },
    { m: 'reverse()',              d: '→ array'          },
    { m: 'at(i)',                  d: '→ item'           },
    { m: 'forEach(fn)',            d: '→ void'           },
    { m: 'toString()',             d: '→ string'         },
  ],
  date: [
    { m: 'toISOString()',          d: '→ string'         },
    { m: 'toLocaleDateString()',   d: '→ string'         },
    { m: 'toLocaleString()',       d: '→ string'         },
    { m: 'getFullYear()',          d: '→ number'         },
    { m: 'getMonth()',             d: '→ number 0-11'    },
    { m: 'getDate()',              d: '→ number'         },
    { m: 'getDay()',               d: '→ number 0-6'     },
    { m: 'getHours()',             d: '→ number'         },
    { m: 'getMinutes()',           d: '→ number'         },
    { m: 'getTime()',              d: '→ ms timestamp'   },
    { m: 'toString()',             d: '→ string'         },
  ],
};

// ── Syntax highlighter ────────────────────────────────────────────────────────

const KEYWORDS = [
  'return','const','let','var','if','else','for','while','do','function',
  'async','await','try','catch','finally','throw','new','typeof',
  'instanceof','in','of','true','false','null','undefined','this',
  'class','switch','case','break','continue',
];

const KW_RE  = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'g');
const STR_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
const NUM_RE = /\b(\d+(?:\.\d+)?)\b/g;
const CMT_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
const PKT_RE = /\b(packet|helpers)\b/g;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(code) {
  const tokens = [];

  function collect(re, cls) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null)
      tokens.push({ start: m.index, end: m.index + m[0].length, cls, text: m[0] });
  }

  collect(CMT_RE, 'sp-hl__comment');
  collect(STR_RE, 'sp-hl__string');
  collect(PKT_RE, 'sp-hl__packet');
  collect(KW_RE,  'sp-hl__keyword');
  collect(NUM_RE, 'sp-hl__number');

  tokens.sort((a, b) => a.start - b.start);
  const filtered = [];
  let lastEnd = 0;
  for (const t of tokens) {
    if (t.start >= lastEnd) { filtered.push(t); lastEnd = t.end; }
  }

  let html = '', pos = 0;
  for (const t of filtered) {
    if (t.start > pos) html += escapeHtml(code.slice(pos, t.start));
    html += `<span class="${t.cls}">${escapeHtml(t.text)}</span>`;
    pos = t.end;
  }
  if (pos < code.length) html += escapeHtml(code.slice(pos));
  return html + '\n';
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

/**
 * Analyse text before cursor and return trigger context.
 * Priority: method completion > field completion > helpers > all
 */
function getTrigger(value, pos) {
  const before = value.slice(0, pos);

  // packet.{knownPath}.{methodPrefix}  — type-aware method/sub-field completion
  // Match a packet path (dots + dollar + word chars + brackets), then a dot, then optional word prefix
  const pktMethod = before.match(/\bpacket\.([\w$.\[\]]+)\.([\w]*)$/);
  if (pktMethod) {
    return {
      type:         'method',
      fieldPath:    pktMethod[1],
      prefix:       pktMethod[2],
      replaceStart: pos - pktMethod[2].length,
    };
  }

  // packet.{prefix}  — field path completion
  const pkt = before.match(/\bpacket\.([\w$.\[\]]*)$/);
  if (pkt) {
    return { type: 'packet', prefix: pkt[1], replaceStart: pos - pkt[1].length };
  }

  // helpers.{prefix}  — helper function completion
  const hlp = before.match(/\bhelpers\.([\w]*)$/);
  if (hlp) {
    return { type: 'helpers', prefix: hlp[1], replaceStart: pos - hlp[1].length };
  }

  // Ctrl+Space — general word completion
  const word = (before.match(/[\w$.[\]]*$/) ?? [''])[0];
  return { type: 'all', prefix: word, replaceStart: pos - word.length };
}

function buildItems(trigger, upstreamFields) {
  const { type, prefix, fieldPath } = trigger;
  const lc = prefix.toLowerCase();

  if (type === 'method') {
    const field = (upstreamFields ?? []).find((f) => f.path === fieldPath);
    const ftype = field?.type ?? 'string';

    // Objects & arrays → show sub-fields from upstreamFields
    if (ftype === 'object' || ftype === 'array') {
      const subPrefix = fieldPath + '.';
      return (upstreamFields ?? [])
        .filter((f) => f.path.startsWith(subPrefix) && f.path !== fieldPath)
        .map((f) => {
          const rel = f.path.slice(subPrefix.length);
          return { label: rel, insert: rel, detail: f.type, kind: 'field' };
        })
        .filter((item) => item.label.toLowerCase().startsWith(lc));
    }

    // Other types → prototype methods
    const methods = TYPE_METHODS[ftype] ?? TYPE_METHODS.string;
    return methods
      .filter((m) => m.m.toLowerCase().startsWith(lc))
      .map((m) => ({ label: m.m, insert: m.m, detail: m.d, kind: 'method' }));
  }

  if (type === 'packet') {
    return (upstreamFields ?? [])
      .filter((f) => f.path.toLowerCase().includes(lc))
      .sort((a, b) => {
        // Prioritize paths that START with the prefix
        const as = a.path.toLowerCase().startsWith(lc);
        const bs = b.path.toLowerCase().startsWith(lc);
        return Number(bs) - Number(as);
      })
      .slice(0, 35)
      .map((f) => ({ label: f.path, insert: f.path, detail: f.type, kind: 'field' }));
  }

  if (type === 'helpers') {
    return HELPER_METHODS
      .filter((m) => m.toLowerCase().startsWith(lc))
      .map((m) => ({ label: m, insert: m, detail: 'helper', kind: 'fn' }));
  }

  // 'all' — mix of packet.* and helpers.*
  const pktItems = (upstreamFields ?? [])
    .filter((f) => `packet.${f.path}`.toLowerCase().includes(lc))
    .slice(0, 20)
    .map((f) => ({ label: `packet.${f.path}`, insert: `packet.${f.path}`, detail: f.type, kind: 'field' }));

  const hlpItems = HELPER_METHODS
    .filter((m) => `helpers.${m}`.toLowerCase().startsWith(lc))
    .map((m) => ({ label: `helpers.${m}`, insert: `helpers.${m}`, detail: 'helper', kind: 'fn' }));

  return [...pktItems, ...hlpItems].slice(0, 40);
}

// ── Cursor viewport position (for position:fixed dropdown) ───────────────────

function getCaretViewport(textarea) {
  const el    = textarea;
  const pos   = el.selectionStart;
  const style = window.getComputedStyle(el);

  const mirror = document.createElement('div');
  const COPY   = [
    'fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing',
    'wordSpacing','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'boxSizing','whiteSpace','wordWrap','overflowWrap',
  ];
  COPY.forEach((p) => { mirror.style[p] = style[p]; });
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden',
    top: '0', left: '0', width: el.offsetWidth + 'px', whiteSpace: 'pre-wrap',
  });

  mirror.textContent = el.value.slice(0, pos);
  const caret = document.createElement('span');
  caret.textContent = '\u200b';
  mirror.appendChild(caret);

  const wrap = el.parentElement;
  wrap.appendChild(mirror);
  const cr = caret.getBoundingClientRect(); // viewport coords of caret bottom
  wrap.removeChild(mirror);

  // Flip upward when not enough room below (dropdown max-height ≈ 220px + gap)
  const flipUp = cr.bottom + 232 > window.innerHeight;
  return {
    // For position:fixed — distances from viewport edges
    top:    flipUp ? undefined : cr.bottom + 2,
    bottom: flipUp ? window.innerHeight - cr.top + 2 : undefined,
    left:   cr.left,
    flipUp,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

const EMPTY_AC = { open: false, items: [], idx: 0, replaceStart: 0, pos: { top: 0, left: 0, flipUp: false } };

export default function ScriptEditor({ value, onChange, placeholder, upstreamFields }) {
  const taRef = useRef(null);
  const hlRef = useRef(null);
  const acRef = useRef(null);
  const [ac, setAc] = useState(EMPTY_AC);

  const highlighted = useMemo(() => highlight(value || ''), [value]);

  const syncScroll = useCallback(() => {
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop  = taRef.current.scrollTop;
      hlRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  // ── Open autocomplete ───────────────────────────────────────────────────

  const openAc = useCallback((val, pos) => {
    const ta = taRef.current;
    if (!ta) return;
    const trigger = getTrigger(val, pos);
    const items   = buildItems(trigger, upstreamFields);
    if (items.length === 0) { setAc(EMPTY_AC); return; }
    const vp = getCaretViewport(ta);
    setAc({ open: true, items, idx: 0, replaceStart: trigger.replaceStart, pos: vp });
  }, [upstreamFields]);

  // ── Insert selected item ────────────────────────────────────────────────

  const insertItem = useCallback((item, replaceStart) => {
    const ta  = taRef.current;
    if (!ta) return;
    const cur  = ta.selectionStart;
    const next = value.slice(0, replaceStart) + item.insert + value.slice(cur);
    onChange(next);
    setAc(EMPTY_AC);
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = replaceStart + item.insert.length;
      ta.setSelectionRange(newPos, newPos);
    });
  }, [value, onChange]);

  // ── Keyboard ────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e) => {
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      openAc(value, e.currentTarget.selectionStart);
      return;
    }

    // Tab → insert 2 spaces (or accept autocomplete item if open)
    if (e.key === 'Tab' && !ac.open) {
      e.preventDefault();
      const ta    = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + 2, start + 2);
      });
      return;
    }

    if (!ac.open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAc((p) => {
        const next = Math.min(p.idx + 1, p.items.length - 1);
        requestAnimationFrame(() =>
          acRef.current?.querySelector('.sp-ac__item--active')?.scrollIntoView({ block: 'nearest' })
        );
        return { ...p, idx: next };
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAc((p) => {
        const next = Math.max(p.idx - 1, 0);
        requestAnimationFrame(() =>
          acRef.current?.querySelector('.sp-ac__item--active')?.scrollIntoView({ block: 'nearest' })
        );
        return { ...p, idx: next };
      });
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertItem(ac.items[ac.idx], ac.replaceStart);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setAc(EMPTY_AC);
      return;
    }
  }, [ac, value, openAc, insertItem]);

  // ── Change — auto-trigger on "packet." and "helpers." ──────────────────

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    onChange(val);
    syncScroll();

    const before = val.slice(0, pos);
    // Auto-trigger on "." after packet path or helpers
    if (/\bpacket\.[\w$.\[\]]*\.$/.test(before) || /\bhelpers\.$/.test(before)) {
      openAc(val, pos);
      return;
    }

    if (ac.open) {
      const trigger = getTrigger(val, pos);
      const items   = buildItems(trigger, upstreamFields);
      if (items.length === 0) {
        setAc(EMPTY_AC);
      } else {
        setAc((p) => ({ ...p, items, idx: 0, replaceStart: trigger.replaceStart }));
      }
    }
  }, [onChange, syncScroll, ac.open, openAc, upstreamFields]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="sp-editor-wrap" onBlur={() => setTimeout(() => setAc(EMPTY_AC), 150)}>
      <pre
        ref={hlRef}
        className="sp-editor__highlight"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      <textarea
        ref={taRef}
        className="sp-editor"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder={placeholder}
      />

      {ac.open && ac.items.length > 0 && (
        <ul
          ref={acRef}
          className="sp-ac"
          style={{
            top:    ac.pos.top,
            bottom: ac.pos.bottom,
            left:   ac.pos.left,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {ac.items.map((item, i) => (
            <li
              key={item.label + i}
              className={`sp-ac__item${i === ac.idx ? ' sp-ac__item--active' : ''}`}
              onMouseEnter={() => setAc((p) => ({ ...p, idx: i }))}
              onClick={() => insertItem(item, ac.replaceStart)}
            >
              <span className={`sp-ac__kind sp-ac__kind--${item.kind}`}>
                {item.kind === 'field' ? 'f' : item.kind === 'method' ? 'm' : 'fn'}
              </span>
              <span className="sp-ac__label">{item.label}</span>
              <span className="sp-ac__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
