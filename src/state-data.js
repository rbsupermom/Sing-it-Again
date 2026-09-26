// Firestore may reorder map fields. Compare their contents while preserving
// array order (queues and histories are ordered data).
export function stableStringify(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  });
}
