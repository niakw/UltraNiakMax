"use strict";
// Public, generic import compatibility for portable Ultra MAX profile v2 exports.
// Does not embed or upload anyone's actual profile, token, or credentials.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UltraMaxPortableProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MAX_CATALOGS = 5000;
  const MAX_FOLDERS = 1500;
  const NEW_NAMESPACE = "com.niakw.ultramax";

  function isGeneratedAddonId(value) {
    const id = String(value || "").trim();
    if (/^com\.(?:niakw\.)?ultramax(?:\.nuvio\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?)?$/i.test(id)) return true;
    try {
      const url = new URL(id);
      return url.protocol === "https:" &&
        url.hostname.toLowerCase() === "ultramax.vip" &&
        /^\/[cn]\/[^/]+(?:\/p\/[^/]+)?\/manifest\.json$/i.test(url.pathname);
    } catch (_) { return false; }
  }

  function convertSource(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) return source;
    // Generated Ultra MAX links MUST be rebound to a freshly generated
    // local token by buildCollectionsExport; never retain the old token.
    if (!isGeneratedAddonId(source.addonId)) return { ...source };
    return { ...source, addonId: NEW_NAMESPACE };
  }

  function normalizePortableProfile(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Le fichier JSON doit contenir un profil Ultra MAX.");
    }
    if (input.kind !== "ultramax-portable-profile") return input;
    if (input.version !== 2 || input.credentialsIncluded !== false) {
      throw new Error("Format de profil portable non pris en charge.");
    }
    for (const key of ["selectedCatalogs", "hiddenCatalogs", "catalogOrder", "collections"]) {
      if (!Array.isArray(input[key])) throw new Error("Profil incomplet : " + key);
    }
    if (input.selectedCatalogs.length > MAX_CATALOGS ||
        input.hiddenCatalogs.length > MAX_CATALOGS ||
        input.catalogOrder.length > MAX_CATALOGS ||
        input.collections.length > 200) {
      throw new Error("Profil dépassant les limites de l'import.");
    }

    let foldersCount = 0, migratedSources = 0, folderOnly = new Set();
    const selectedIds = new Set(input.selectedCatalogs);
    const collections = input.collections.map(coll => {
      if (!coll || typeof coll !== "object" || !Array.isArray(coll.folders)) {
        throw new Error("Structure de collection invalide.");
      }
      foldersCount += coll.folders.length;
      if (foldersCount > MAX_FOLDERS) throw new Error("Trop de dossiers dans le profil.");
      return {
        ...coll,
        folders: coll.folders.map(folder => {
          if (!folder || typeof folder !== "object") {
            throw new Error("Structure de dossier invalide.");
          }
          const oldSources = Array.isArray(folder.sources) ? folder.sources : [];
          const oldCatalogSources = Array.isArray(folder.catalogSources) ? folder.catalogSources : [];
          const oldNativeSources = Array.isArray(folder.nativeSources) ? folder.nativeSources : [];
          const originalGenerated = [...oldSources, ...oldCatalogSources, ...oldNativeSources]
            .filter(s => s && isGeneratedAddonId(s.addonId)).length;
          migratedSources += originalGenerated;
          (Array.isArray(folder.rows) ? folder.rows : []).forEach(id => {
            if (!selectedIds.has(id)) folderOnly.add(id);
          });
          return {
            ...folder,
            sources: oldSources.map(convertSource),
            catalogSources: oldCatalogSources.map(convertSource),
            // Keep *true* external sources, never let stale generated
            // Ultra MAX credentials/IDs survive as Nuvio native sources.
            nativeSources: oldNativeSources
              .filter(s => !s || !isGeneratedAddonId(s.addonId))
              .map(convertSource)
          };
        })
      };
    });
    return {
      ...input,
      setup: input.setup && typeof input.setup === "object" ? { ...input.setup } : {},
      contentFilters: input.contentFilters && typeof input.contentFilters === "object"
        ? { ...input.contentFilters } : {},
      collections,
      selectedCatalogs: input.selectedCatalogs.slice(),
      hiddenCatalogs: input.hiddenCatalogs.slice(),
      catalogOrder: input.catalogOrder.slice(),
      // Not saved by importProjectData; for local preview only.
      _migrationSummary: {
        selected: input.selectedCatalogs.length,
        hidden: input.hiddenCatalogs.length,
        collections: collections.length,
        folders: foldersCount,
        folderOnlyCatalogs: folderOnly.size,
        migratedSources
      }
    };
  }
  return { normalizePortableProfile, isGeneratedAddonId };
});
