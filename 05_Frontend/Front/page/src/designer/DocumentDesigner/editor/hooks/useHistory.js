// useHistory.js — Undo/Redo para el estado del template
//
// Modelo clásico past / present / future:
//   - presentRef: el último template comprometido (espejo del estado de React)
//   - pastRef:    estados anteriores (pila de undo)
//   - futureRef:  estados deshechos (pila de redo)
//
// `record(next)` se llama en CADA cambio comprometido con el NUEVO estado.
// Es idempotente: si `next` ya es el present (p. ej. el doble-invoke del updater
// de setState en React StrictMode/dev), no duplica entradas en el historial.
import { useRef, useCallback } from 'react';

const MAX_HISTORY = 100;

export function useHistory(onRestore, initialPresent) {
  const pastRef    = useRef([]);            // estados anteriores (undo)
  const futureRef  = useRef([]);            // estados deshechos (redo)
  const presentRef = useRef(initialPresent); // estado actual comprometido

  // Registra una transición al nuevo estado `next`. Empuja el present anterior
  // a la pila de undo y limpia la de redo. No-op si `next` no cambió (idempotente
  // frente al doble-invoke del updater en StrictMode).
  const record = useCallback((next) => {
    const prev = presentRef.current;
    if (prev === next) return;             // sin cambio real → no se registra
    if (prev !== undefined) {
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), prev];
    }
    futureRef.current = [];                // un cambio nuevo invalida el redo
    presentRef.current = next;
  }, []);

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return false;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [presentRef.current, ...futureRef.current];
    presentRef.current = prev;
    onRestore(prev);
    return true;
  }, [onRestore]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return false;
    const [next, ...rest] = futureRef.current;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, presentRef.current];
    presentRef.current = next;
    onRestore(next);
    return true;
  }, [onRestore]);

  const canUndo = () => pastRef.current.length > 0;
  const canRedo = () => futureRef.current.length > 0;

  return { record, undo, redo, canUndo, canRedo };
}
