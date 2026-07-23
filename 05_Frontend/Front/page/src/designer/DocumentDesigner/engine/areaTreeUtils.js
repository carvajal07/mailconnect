// engine/areaTreeUtils.js — Pure recursive helpers for the content-area tree

export function findAreaById(areas, id) {
  for (const a of areas) {
    if (a.id === id) return a;
    if (a.children?.length) {
      const f = findAreaById(a.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function mapAreaInTree(areas, id, fn) {
  return areas.map(a => {
    if (a.id === id) return fn(a);
    if (a.children?.length) return { ...a, children: mapAreaInTree(a.children, id, fn) };
    return a;
  });
}

export function removeAreaFromTree(areas, id) {
  return areas
    .filter(a => a.id !== id)
    .map(a => a.children?.length ? { ...a, children: removeAreaFromTree(a.children, id) } : a);
}

export function addChildToAreaInTree(areas, parentId, newArea) {
  return areas.map(a => {
    if (a.id === parentId) return { ...a, children: [...(a.children ?? []), newArea] };
    if (a.children?.length) return { ...a, children: addChildToAreaInTree(a.children, parentId, newArea) };
    return a;
  });
}

export function reorderAreaInTree(areas, areaId, direction) {
  const idx = areas.findIndex(a => a.id === areaId);
  if (idx !== -1) {
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= areas.length) return areas;
    const arr = [...areas];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    return arr;
  }
  return areas.map(a =>
    a.children?.length
      ? { ...a, children: reorderAreaInTree(a.children, areaId, direction) }
      : a
  );
}
