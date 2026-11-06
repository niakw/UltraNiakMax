"use strict";
const blocked=new Set(["__proto__","constructor","prototype"]);
function safeCatalogId(id) {
  return typeof id==="string" && id.length>0 && id.length<=160 &&
    /^[A-Za-z0-9_.:-]+$/.test(id) && !blocked.has(id.toLowerCase());
}
function parseCatalogPath(pathname) {
  if (typeof pathname!=="string" || pathname.length>4096 ||
      !pathname.endsWith(".json")) return null;
  const parts=pathname.split("/");
  const configured=parts[1]==="c" && parts[3]==="catalog";
  const plain=parts[1]==="catalog";
  if(!configured && !plain) return null;
  const base=configured?4:2;
  if(parts.length<base+2) return null;
  const token=configured?parts[2]:null;
  const rawType=parts[base],rawId=parts[base+1];
  let type,id,extra;
  try {
    type=decodeURIComponent(rawType);
    id=decodeURIComponent(parts.length===base+2?rawId.slice(0,-5):rawId);
    extra=parts.length===base+2?null:
      decodeURIComponent(parts.slice(base+2).join("/").slice(0,-5));
  } catch {return null;}
  if(!safeCatalogId(type) || !safeCatalogId(id) ||
      (configured && !safeCatalogId(token))) return null;
  return {token,type,id,extraStr:extra};
}
function parseCatalogExtra(extraStr) {
  const extra=Object.create(null);
  if (!extraStr || extraStr.length>4096) return extra;
  const safe=(key,value)=>{
    if(typeof key!=="string" || key.length>60 || blocked.has(key.toLowerCase()) ||
       !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key)) return;
    if(typeof value==="string" && value.length<=1500) extra[key]=value;
    else if(typeof value==="number" && Number.isFinite(value)) extra[key]=value;
    else if(typeof value==="boolean") extra[key]=value;
  };
  if(extraStr.startsWith("{")) {
    try {
      const value=JSON.parse(extraStr);
      if(value && typeof value==="object" && !Array.isArray(value))
        for(const [key,item] of Object.entries(value)) safe(key,item);
    }catch{}
  } else {
    for(const [k,v] of new URLSearchParams(extraStr).entries()) safe(k,v);
  }
  return extra;
}
function registerCatalogRoutes(app, deps) {
console.log("CATALOG ROUTE SERVICE ACTIVE");
  const {
    FILTER_ENABLED,
    QUICK_PICK_CATALOGS,
    DYNAMIC_CATALOGS,
    staticIds,
    CATALOG_DEFS,
    buildManifestCatalogs,
    handleCatalogService,
    catalogDeps,
    loadConfigs,
    MDBLIST_KEY
  } = deps;

app.use((req, res, next) => {
  const url = req.path;
  if (url.includes("/manifest.json") && !url.startsWith("/c/")) {
    const fullManifest = {
      id: FILTER_ENABLED ?"org.kris.ultra.max.v5" :"org.kris.ultra.max.all.v5",
      version:"7.0.0",
  logo: "https://ultramax.vip/logo.svg",
      name: FILTER_ENABLED ?"Ultra MAX" :"Ultra MAX All",
      description: FILTER_ENABLED ?"Curated discovery with filtered rows and cleaner collections." :"Full Ultra MAX discovery with all available rows.",
      types: ["movie","series"],
      resources: ["catalog","meta","stream"],
      catalogs: [
        ...QUICK_PICK_CATALOGS,
        ...buildManifestCatalogs(
  staticIds,
  CATALOG_DEFS
),
        ...DYNAMIC_CATALOGS.map(c => ({ type: c.type, id: c.id, name: c.name, extra: [{ name:"tmdbId", isRequired: true }] })),
        { type:"movie", id:"search_movies", name:"Ultra MAX Search", extra:[{ name:"search", isRequired:true }], extraSupported:["search"] },
        { type:"series", id:"search_series", name:"Ultra MAX Search", extra:[{ name:"search", isRequired:true }], extraSupported:["search"] }
      ]
    };
    fullManifest.catalogs = (fullManifest.catalogs || [])
  .filter(c => c && c.id) // keep valid ones only
  .map(c => ({
    ...c,
    name: (c.name || "").trim()
  }));

    return res.json(fullManifest);
  }
  const parsed=parseCatalogPath(url);
  if (parsed && !parsed.token) {
      const {type,id,extraStr}=parsed;
      const extra=parseCatalogExtra(extraStr);
        handleCatalogService(
  id,
  type,
  extra,
  null,
  FILTER_ENABLED,
  "en-US",
  null,
  null,
  null,
  false,
  null,
  false,
  null,
  null,
  null,
  null,
  catalogDeps
)
        .then(result => { res.setHeader("Cache-Control","public, max-age=60"); res.json(result); })
        .catch(() => res.json({ metas: [] }));
      return;
  }
  if (parsed && parsed.token) {
      let {token,type,id,extraStr}=parsed;
      if(id==="search_movie") id="search_movies";
      const configs=loadConfigs();
      const config=Object.prototype.hasOwnProperty.call(configs,token)?
        configs[token]:null;
      if(!config) return res.json({metas:[]});
      const extra=parseCatalogExtra(extraStr);
      if(req.query.skip!==undefined) {
        const skip=Number(req.query.skip);
        if(Number.isSafeInteger(skip)&&skip>=0&&skip<=10000) extra.skip=skip;
      }
      if(typeof req.query.search==="string") extra.search=req.query.search.slice(0,300);
      const hasAnime=Array.isArray(config.catalogs)&&
        config.catalogs.some(c=>typeof c==="string"&&
          ["anime","bollywood","crunchyroll","hidive"].some(tag=>c.includes(tag)));
       handleCatalogService(
        id,
        type,
        extra,
        config.mdblistKey || MDBLIST_KEY,
        !hasAnime,
        config.language || "en-US",
        config.rpdbKey || null,
        config.tpKey || null,
        config.traktUser || null,
        config.excludeUnreleased || false,
        config.maxRating || null,
        config.includeAdult || false,
        config.customCatalogs || [],
        config.googleAiKey || null,
        config.fanartKey || null,
        config.omdbKey || null,
        catalogDeps
      )
        .then(result => { res.setHeader("Cache-Control","private, no-store"); res.json(result); })
        .catch(() => res.json({ metas: [] }));
      return;
  }
  next();
});

}

module.exports = {
  registerCatalogRoutes,parseCatalogPath,parseCatalogExtra
};
