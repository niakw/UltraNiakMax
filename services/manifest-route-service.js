function getOwnProfile(configs,token) {
  if(typeof token!=="string" || !/^[A-Za-z0-9_-]{6,80}$/.test(token) ||
     ["__proto__","constructor","prototype"].includes(token.toLowerCase()) ||
     !Object.prototype.hasOwnProperty.call(configs,token)) return null;
  const value=configs[token];
  if(!value || typeof value!=="object" || Array.isArray(value) ||
      Object.getPrototypeOf(value)!==Object.prototype) return null;
  return value;
}

function updatedLastAccess(configs,token,profile) {
  if(profile.lastAccessed && Number.isFinite(Date.parse(profile.lastAccessed)) &&
      Date.now()-Date.parse(profile.lastAccessed)<=24*60*60*1000) return null;
  const refreshed={...profile,lastAccessed:new Date().toISOString()};
  return Object.assign(Object.create(null),
    Object.fromEntries(Object.entries(configs).map(([key,value])=>
      [key,key===token?refreshed:value])));
}

function handleNuvioManifest(req, res, deps) {
  const {
  loadConfigs,
  saveConfigs,
  buildCatalogsFromIds,
  QUICK_PICK_CATALOGS,
  CATALOG_DEFS
    } = deps;

  const { token } = req.params;
  const configs = loadConfigs();
  const config = getOwnProfile(configs,token);

  if (!config) {
    return res.status(404).json({ error: "Config not found" });
  }

  const changed=updatedLastAccess(configs,token,config);
  if(changed) saveConfigs(changed);

  const catalogs = buildCatalogsFromIds(
    config.enableAiRecommended
      ? Array.from(
          new Set([
            ...(config.catalogs || []),
            "ai_recommended_movies",
            "ai_recommended_series"
          ])
        )
      : (config.catalogs || []),
    config.hiddenCatalogs || [],
    QUICK_PICK_CATALOGS,
  CATALOG_DEFS
  ).map(c => ({
    type: c.type,
    id: c.id,
    name: c.name,
    extra: [{ name: "skip", isRequired: false }]
  }));

  return res.json({
    id: "com.niakw.ultramax.nuvio." + token.toLowerCase(),
    version: "7.0.0",
    name: "Ultra MAX (niakw)",
    description: "Ultra MAX Nuvio compatible manifest",
    logo: "https://ultramax.vip/logo.svg",
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    resources: ["catalog", "meta", "stream"],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
      adult: false,
      p2p: false
    },
    catalogs
  });
}

function handleCinemetaClone(req, res) {
  console.log(
    "CINEMETA CLONE HIT",
    new Date().toISOString(),
    req.headers["user-agent"]
  );

  return res.json({
    id: "com.ultramax.cinemeta.clone",
    version: "1.0.0",
    description: "Cinemeta style test manifest",
    name: "Ultra MAX Cinemeta Clone",
    resources: ["catalog", "meta", "addon_catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
      {
        type: "movie",
        id: "top",
        name: "Popular",
        genres: ["Action", "Comedy", "Drama"],
        extra: [
          { name: "genre", options: ["Action", "Comedy", "Drama"] },
          { name: "search" },
          { name: "skip" }
        ],
        extraSupported: ["search", "genre", "skip"]
      }
    ],
    behaviorHints: {
      newEpisodeNotifications: true
    }
  });
}

function handleMainManifest(req, res, deps) {
const {
  loadConfigs,
  saveConfigs,
  buildCatalogsFromIds,
  QUICK_PICK_CATALOGS,
  CATALOG_DEFS
} = deps;

  const { token } = req.params;
  const configs = loadConfigs();
  const config = getOwnProfile(configs,token);

  if (!config) {
    return res.status(404).json({ error: "Config not found" });
  }

  const changed=updatedLastAccess(configs,token,config);
  if(changed) saveConfigs(changed);

  const manifest = {
    id: "com.niakw.ultramax." + token.toLowerCase(),
    version: "7.0.0",
    name: "Ultra MAX (niakw)",
    description: `Ultra MAX setup with ${config.catalogs.length} curated rows. Built for cleaner discovery and smoother browsing.`,
    logo: "https://ultramax.vip/logo.svg",
    types: ["movie", "series"],
    idPrefixes: ["tt", "tmdb"],
    resources: ["catalog", "meta", "stream"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      adult: false,
      p2p: false
    },
    catalogs: buildCatalogsFromIds(
      config.enableAiRecommended
        ? Array.from(
            new Set([
              ...(config.catalogs || []),
              "ai_recommended_movies",
              "ai_recommended_series"
            ])
          )
        : (config.catalogs || []),
      config.hiddenCatalogs || [],
      QUICK_PICK_CATALOGS,
  CATALOG_DEFS
    )
      .map(c => ({
        type: c.type,
        id: c.id,
        name: c.name,
        extra: [{ name: "skip", isRequired: false }],
        extraSupported: ["skip"],
        pageSize: 100
      }))
      .concat([
        {
          type: "movie",
          id: "search_movies",
          name: "Ultra MAX Search",
          extra: [{ name: "search", isRequired: true }],
          extraSupported: ["search"]
        },
        {
          type: "series",
          id: "search_series",
          name: "Ultra MAX Search",
          extra: [{ name: "search", isRequired: true }],
          extraSupported: ["search"]
        }
      ])
  };

  return res.json(manifest);
}

module.exports = {
  handleNuvioManifest,
  handleCinemetaClone,
  handleMainManifest,
  getOwnProfile,
  updatedLastAccess
};
