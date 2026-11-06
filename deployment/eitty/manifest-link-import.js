(function () {
  "use strict";
  // Import an existing addon catalog list by pasting its manifest URL.
  // Source links and their access tokens are never persisted in project drafts.
  function el(id) { return document.getElementById(id); }
  function make(tag, text) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  var preview = null;
  var compatible = [];
  var unknown = [];

  function closeModal() {
    var modal = el("eittyManifestImportModal");
    if (modal) modal.hidden = true;
    if (el("eittyManifestImportUrl")) el("eittyManifestImportUrl").value = "";
    if (el("eittyManifestImportResults")) el("eittyManifestImportResults").replaceChildren();
    if (el("eittyManifestImportStatus")) el("eittyManifestImportStatus").textContent = "";
    preview = null; compatible = []; unknown = [];
    if (el("eittyManifestImportApply")) el("eittyManifestImportApply").disabled = true;
  }
  function showModal() {
    var modal = el("eittyManifestImportModal");
    if (!modal) return;
    modal.hidden = false;
    el("eittyManifestImportUrl").focus();
  }
  function knownCatalogIds() {
    var ids = new Set();
    document.querySelectorAll(".pill[data-id]").forEach(function (node) {
      ids.add(node.getAttribute("data-id"));
    });
    return ids;
  }
  function describePreview(data) {
    var ids = knownCatalogIds();
    compatible = [];
    unknown = [];
    var seen = new Set();
    data.catalogs.forEach(function (cat) {
      var id = cat.id;
      var normalized = typeof normalizeCatalogId === "function" ? normalizeCatalogId(id) : id;
      var recognized = ids.has(id) ? id : (ids.has(normalized) ? normalized : "");
      if (recognized && !seen.has(recognized)) {
        seen.add(recognized);
        compatible.push({ id: recognized, name: cat.name, type: cat.type });
      } else if (!recognized) {
        unknown.push(cat);
      }
    });
    var results = el("eittyManifestImportResults");
    results.replaceChildren();
    results.appendChild(make("strong", "Manifest : " + data.name));
    results.appendChild(make("p",
      compatible.length + " catalogue(s) reconnus sur " + data.catalogs.length +
      ". " + unknown.length + " non reconnus (non importés)."));
    var list = make("ul");
    list.style.maxHeight = "180px";
    list.style.overflow = "auto";
    compatible.slice(0, 80).forEach(function (cat) {
      list.appendChild(make("li", cat.name + " — " + cat.type));
    });
    results.appendChild(list);
    if (unknown.length) {
      results.appendChild(make("p", "À vérifier manuellement : " +
        unknown.slice(0, 12).map(function (cat) { return cat.name; }).join(", ") +
        (unknown.length > 12 ? "…" : "")));
    }
    results.appendChild(make("small",
      "Seuls les catalogues reconnus sont importés. Les clés API, les filtres et les collections existantes restent conservés. " +
      "L'URL source et son jeton ne sont pas enregistrés."));
    el("eittyManifestImportApply").disabled = compatible.length === 0;
  }
  async function requestPreview() {
    var input = el("eittyManifestImportUrl");
    var url = input.value.trim();
    var status = el("eittyManifestImportStatus");
    var button = el("eittyManifestImportPreview");
    preview = null; compatible = []; unknown = [];
    el("eittyManifestImportApply").disabled = true;
    el("eittyManifestImportResults").replaceChildren();
    if (!url || url.length > 4096 || !url.startsWith("https://")) {
      status.textContent = "Colle une URL HTTPS complète terminant par manifest.json.";
      return;
    }
    status.textContent = "Lecture du manifeste…";
    button.disabled = true;
    try {
      var response = await fetch("/api/import-manifest", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || "Manifeste inaccessible.");
      if (data.format !== "ultramax-manifest-preview-v1" || !Array.isArray(data.catalogs))
        throw new Error("Réponse de manifeste invalide.");
      preview = data;
      describePreview(data);
      status.textContent = "Aperçu chargé. Vérifie les catalogues avant d'appliquer.";
    } catch (error) {
      status.textContent = String(error && error.message || "Import impossible.");
    } finally {
      // Sensitive source token stays neither in the draft nor in the input.
      input.value = "";
      button.disabled = false;
    }
  }
  function applyPreview() {
    if (!preview || !compatible.length) return;
    var mode = el("eittyManifestImportMode").value;
    var planner = window.UltraMaxCatalogImport;
    var status = el("eittyManifestImportStatus");
    if (!planner || typeof planner.planImport !== "function" ||
        typeof selected === "undefined" || typeof hidden === "undefined") {
      status.textContent = "Le gestionnaire de catalogues n'est pas disponible.";
      return;
    }
    var plan;
    try {
      plan = planner.planImport({
        mode: mode,
        imported: compatible.map(function (cat) { return cat.id; }),
        selected: Array.from(selected),
        hidden: Array.from(hidden),
        order: Array.isArray(catalogOrder) ? catalogOrder : []
      });
    } catch (error) {
      status.textContent = "Préparation impossible : " + (error.message || "catalogues invalides");
      return;
    }
    var message = mode === "replace"
      ? "Remplacer les catalogues sélectionnés et masquer les anciens ? Les collections et clés existantes restent conservées."
      : "Ajouter " + plan.added + " nouveaux catalogues sans effacer les paramètres, les collections ni les clés API ?";
    if (!window.confirm(message)) return;
    // Do not call importProjectData here: that API resets the entire form,
    // including private credentials, debrid settings and custom collections.
    selected.clear();
    plan.selected.forEach(function (id) { selected.add(id); });
    hidden.clear();
    plan.hidden.forEach(function (id) { hidden.add(id); });
    catalogOrder = plan.order;
    document.querySelectorAll(".pill[data-id]").forEach(function (pill) {
      var id = pill.getAttribute("data-id");
      pill.classList.toggle("selected", selected.has(id));
      var isHidden = hidden.has(id);
      pill.style.fontStyle = isHidden ? "italic" : "";
      var eye = pill.querySelector(".pill-eye");
      if (eye) {
        eye.style.display = isHidden ? "inline" : "none";
        eye.textContent = isHidden ? "🙈" : "👁";
        eye.style.opacity = isHidden ? "1" : "0.4";
      }
    });
    if (typeof saveHiddenState === "function") saveHiddenState();
    if (typeof updateCounter === "function") updateCounter();
    if (typeof updateCategoryCounts === "function") updateCategoryCounts();
    if (typeof renderCollections === "function") renderCollections();
    if (typeof saveDraftState === "function") saveDraftState();
    closeModal();
    if (typeof showBanner === "function") {
      showBanner(mode === "merge"
        ? "Catalogue(s) ajouté(s) : " + plan.added + ". Paramètres et collections conservés."
        : "Sélection mise à jour : " + plan.selected.length + " catalogues. Paramètres privés conservés.",
        "success");
    }
  }

  function initialize() {
    if (!el("step1Toolbar") || el("eittyManifestImportModal")) return;
    var button = make("button", "Importer un manifeste");
    button.type = "button";
    button.id = "eittyManifestImportLaunch";
    button.style.cssText =
      "padding:11px 14px;border:1px solid var(--border2);border-radius:12px;" +
      "background:var(--hover);color:var(--text);font:600 13px inherit;cursor:pointer";
    button.addEventListener("click", showModal);
    el("step1Toolbar").insertBefore(button, el("step1Toolbar").lastElementChild);

    var modal = make("div");
    modal.id = "eittyManifestImportModal";
    modal.hidden = true;
    modal.style.cssText = "position:fixed;inset:0;z-index:100000;" +
      "background:rgba(0,0,0,.83);padding:16px;overflow:auto;";
    var content = make("section");
    content.setAttribute("role", "dialog");
    content.setAttribute("aria-modal", "true");
    content.setAttribute("aria-label", "Importer un manifeste existant");
    content.style.cssText = "max-width:640px;margin:8vh auto;background:#151525;color:#f5f5ff;" +
      "padding:24px;border-radius:16px;border:1px solid #555075;box-shadow:0 18px 70px #000a;";
    content.appendChild(make("h2", "Importer un manifeste par URL"));
    content.appendChild(make("p",
      "Colle le lien manifest.json de ton Ultra MAX ou d'un autre addon compatible. " +
      "Les catalogues reconnus seront prévisualisés, sans copier ton jeton."));
    var input = make("input");
    input.id = "eittyManifestImportUrl";
    input.type = "url";
    input.maxLength = 4096;
    input.autocomplete = "off";
    input.placeholder = "https://example.org/c/TOKEN/manifest.json";
    input.style.cssText = "box-sizing:border-box;width:100%;padding:13px;color:#fff;" +
      "background:#070710;border:1px solid #555075;border-radius:8px;";
    content.appendChild(input);
    var previewButton = make("button", "Prévisualiser");
    previewButton.id = "eittyManifestImportPreview";
    previewButton.type = "button";
    previewButton.style.cssText = "margin-top:12px;padding:11px 16px;border:0;" +
      "border-radius:8px;background:#7850dc;color:#fff;cursor:pointer";
    previewButton.addEventListener("click", requestPreview);
    content.appendChild(previewButton);
    var status = make("p");
    status.id = "eittyManifestImportStatus";
    status.setAttribute("role", "status");
    content.appendChild(status);
    var results = make("div");
    results.id = "eittyManifestImportResults";
    content.appendChild(results);
    var modeLabel = make("label", "Méthode d'importation");
    modeLabel.setAttribute("for", "eittyManifestImportMode");
    modeLabel.style.cssText = "display:block;margin-top:14px;margin-bottom:6px;font-weight:600";
    content.appendChild(modeLabel);
    var modeSelect = make("select");
    modeSelect.id = "eittyManifestImportMode";
    modeSelect.style.cssText = "padding:10px 12px;max-width:100%;color:#fff;background:#272139;border:1px solid #665b86;border-radius:8px";
    [["merge", "Ajouter sans effacer (recommandé)"],
     ["replace", "Remplacer uniquement les catalogues sélectionnés"]].forEach(function (option) {
      var item = make("option", option[1]);
      item.value = option[0];
      modeSelect.appendChild(item);
    });
    content.appendChild(modeSelect);
    content.appendChild(make("p", "Les clés, les filtres et les collections personnalisées ne sont jamais réinitialisés par l'import du manifeste."));
    var buttons = make("div");
    buttons.style.cssText = "display:flex;gap:12px;justify-content:flex-end;margin-top:16px";
    var cancel = make("button", "Annuler");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    var apply = make("button", "Importer les catalogues");
    apply.id = "eittyManifestImportApply";
    apply.type = "button";
    apply.disabled = true;
    apply.addEventListener("click", applyPreview);
    [cancel, apply].forEach(function (b) {
      b.style.cssText = "padding:11px 14px;border:1px solid #665b86;border-radius:8px;" +
        "background:#272139;color:#fff;cursor:pointer";
      buttons.appendChild(b);
    });
    content.appendChild(buttons);
    modal.appendChild(content);
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") requestPreview(); });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else initialize();
})();
