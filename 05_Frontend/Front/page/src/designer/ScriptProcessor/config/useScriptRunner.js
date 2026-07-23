// src/nodes/ScriptProcessor/config/useScriptRunner.js
// Hook: run a ScriptProcessor script against a mock packet built from upstream fields.
// Captures console output and shows result / error.

import { useState, useCallback } from 'react';
import { helpers }   from '../engine/scriptHelpers.js';
import { setPath }   from '../../DataProcessor/engine/JsonPath.js';

// ── Mock packet builder (mirrors DataViewer logic) ────────────────────────────

const MOCK_VALUES = {
  string:  'text_example',
  integer: 42,
  number:  3.14,
  boolean: true,
  array:   ['a', 'b', 'c'],
  object:  {},
  date:    new Date().toISOString(),
  any:     'value',
};

function buildMockPacket(fields) {
  let packet = {};
  (fields ?? []).forEach((f) => {
    if (f.type === 'object') return;
    const val = f.mockValue !== undefined ? f.mockValue : (MOCK_VALUES[f.type] ?? 'value');
    try { packet = setPath(f.path, packet, val); } catch { /* skip bad paths */ }
  });
  return packet;
}

// ── Sandboxed execution with packet + helpers context ────────────────────────

const ALLOWED_GLOBALS = {
  JSON, Math, Number, String, Boolean, Array, Object, Date, RegExp,
  parseInt, parseFloat, isNaN, isFinite,
  encodeURIComponent, decodeURIComponent, btoa, atob, structuredClone,
};

function runNodeScript(code, packet, helpersObj, capturedLogs) {
  // Proxy console to capture output
  const fakeConsole = {
    log:   (...args) => capturedLogs.push({ level: 'log',   msg: formatArgs(args) }),
    warn:  (...args) => capturedLogs.push({ level: 'warn',  msg: formatArgs(args) }),
    error: (...args) => capturedLogs.push({ level: 'error', msg: formatArgs(args) }),
    info:  (...args) => capturedLogs.push({ level: 'info',  msg: formatArgs(args) }),
  };

  const paramNames  = ['packet', 'helpers', 'console', ...Object.keys(ALLOWED_GLOBALS)];
  const paramValues = [
    Object.freeze(structuredClone(packet)),
    helpersObj,
    fakeConsole,
    ...Object.values(ALLOWED_GLOBALS),
  ];

  let fn;
  try {
    fn = new Function(...paramNames, `"use strict";\n${code}`);
  } catch (e) {
    throw new Error(`Error de sintaxis: ${e.message}`);
  }

  const start  = Date.now();
  const result = fn(...paramValues);

  if (Date.now() - start > 1000) {
    throw new Error('Script timeout (>1000ms)');
  }

  return result;
}

function formatArgs(args) {
  return args.map((a) => {
    if (a === null)          return 'null';
    if (a === undefined)     return 'undefined';
    if (typeof a === 'object') {
      try { return JSON.stringify(a, null, 2); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const IDLE = { status: 'idle', result: null, logs: [], error: null };

export function useScriptRunner(script, upstreamFields) {
  const [state, setState] = useState(IDLE);

  const run = useCallback(() => {
    if (!script?.trim()) {
      setState({ ...IDLE, status: 'error', error: 'El script está vacío.' });
      return;
    }

    setState({ ...IDLE, status: 'running' });

    const capturedLogs = [];
    const mockPacket   = buildMockPacket(upstreamFields ?? []);

    let result = null;
    let error  = null;
    try {
      result = runNodeScript(script, mockPacket, helpers, capturedLogs);
    } catch (e) {
      error = e.message;
    }

    setState({
      status:  error ? 'error' : 'ok',
      result:  result ?? null,
      logs:    capturedLogs,
      error:   error ?? null,
    });
  }, [script, upstreamFields]);

  const clear = useCallback(() => setState(IDLE), []);

  return { ...state, run, clear };
}
