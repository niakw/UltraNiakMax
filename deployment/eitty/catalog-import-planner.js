"use strict";
/**
 * Non-destructive Stremio/Nuvio manifest catalog import planning.
 * This module never receives a provider credential or a user profile JSON.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UltraMaxCatalogImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanIds(list, requireManifestId = false) {
    if (!Array.isArray(list) || list.length > 5000) throw new Error("Invalid catalog list");
    const result = [], seen = new Set();
    for (const value of list) {
      if (typeof value !== "string" || !value || value.length > 1024) continue;
      // The imported manifest IDs follow the validated public contract.
      // An existing custom catalog ID may have a different syntax: never
      // silently delete it just because a manifest is being merged.
      if (requireManifestId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }
  function planImport(input) {
    if (!input || !["merge", "replace"].includes(input.mode)) throw new Error("Invalid import mode");
    const imported = cleanIds(input.imported, true);
    if (!imported.length || imported.length > 700) throw new Error("No supported catalogs to import");
    const existing = cleanIds(input.selected || []);
    const hidden = cleanIds(input.hidden || []);
    const order = cleanIds(input.order || []);
    const selected = input.mode === "merge"
      ? cleanIds(existing.concat(imported))
      : imported.slice();
    const allowed = new Set(selected);
    const resultHidden = input.mode === "merge"
      ? hidden.filter(id => allowed.has(id))
      : [];
    const resultOrder = input.mode === "merge"
      ? cleanIds(order.filter(id => allowed.has(id)).concat(selected))
      : imported.slice();
    return {
      selected, hidden: resultHidden, order: resultOrder,
      added: selected.length - (input.mode === "merge" ? existing.length : 0),
      replaced: input.mode === "replace"
    };
  }
  return { planImport };
});
