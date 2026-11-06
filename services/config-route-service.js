"use strict";
const {rateLimit: expressRateLimit}=require("express-rate-limit");
const authLimiter=expressRateLimit({windowMs:60000,limit:30,standardHeaders:"draft-8",legacyHeaders:false});
const reservedTokens=new Set(["__proto__","prototype","constructor"]);
function recordForToken(configs,token) {
  if(typeof token!=="string" || token.length<6 || token.length>80 ||
      !/^[A-Za-z0-9_-]+$/.test(token) || reservedTokens.has(token.toLowerCase()) ||
      !Object.prototype.hasOwnProperty.call(configs,token)) return null;
  const record=configs[token];
  return record && typeof record==="object" && !Array.isArray(record) ? record : null;
}
function hasUnsafeKeys(value,depth=0) {
  if(depth>16) return true;
  if(!value || typeof value!=="object") return false;
  if(Object.keys(value).length>300) return true;
  for(const [key,item] of Object.entries(value)) {
    if(reservedTokens.has(key.toLowerCase()) || hasUnsafeKeys(item,depth+1)) return true;
  }
  return false;
}
function migrateLegacyPassword(config, password, hashPassword, saveConfigs, configs) {
  if (typeof config.passwordHash === "string" &&
      !config.passwordHash.startsWith("scrypt:")) {
    config.passwordHash=hashPassword(password);
    saveConfigs(configs);
  }
}
function registerConfigRoutes(app, deps) {
  const {
    loadConfigs,
    saveConfigs,
    hashPassword,
    verifyPassword,
    generateToken,
    rateLimit
  } = deps;

  app.post("/c/create", authLimiter, (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;

    if (rateLimit(ip, 5, 60000)) {
      return res.status(429).json({ error: "Too many requests." });
    }

    const {
      password,
      catalogs,
      mdblistKey,
      language,
      rpdbKey,
      tpKey,
      fanartKey,
      omdbKey,
      traktUser,
      excludeUnreleased,
      maxRating,
      streamAddons,
      customCatalogs,
      googleAiKey,
      enableAiRecommended,
      hiddenCatalogs
    } = req.body;

    if (!password || !catalogs || !catalogs.length) {
      return res.status(400).json({
        error: "Password and catalogs required"
      });
    }

    const configs = loadConfigs();

    let token = generateToken();
    while (configs[token]) token = generateToken();

    configs[token] = {
      passwordHash: hashPassword(password),
      catalogs,
      mdblistKey: mdblistKey || null,
      language: language || "en-US",
      rpdbKey: rpdbKey || null,
      tpKey: tpKey || null,
      fanartKey: fanartKey || null,
      omdbKey: omdbKey || null,
      traktUser: traktUser || null,
      excludeUnreleased: !!excludeUnreleased,
      maxRating: maxRating || null,
      streamAddons: Array.isArray(streamAddons)
        ? streamAddons.filter(Boolean)
        : [],
      customCatalogs: Array.isArray(customCatalogs)
        ? customCatalogs.filter(Boolean)
        : [],
      googleAiKey: googleAiKey || null,
      enableAiRecommended: !!enableAiRecommended,
      hiddenCatalogs: Array.isArray(hiddenCatalogs)
        ? hiddenCatalogs
        : [],
      createdAt: new Date().toISOString()
    };

    saveConfigs(configs);

    res.json({ token });
  });

  app.post("/c/:token/update", authLimiter, (req, res) => {
    const { token } = req.params;

    const {
      password,
      catalogs,
      mdblistKey,
      language,
      rpdbKey,
      tpKey,
      fanartKey,
      omdbKey,
      traktUser,
      excludeUnreleased,
      maxRating,
      streamAddons,
      customCatalogs,
      googleAiKey,
      enableAiRecommended,
      hiddenCatalogs
    } = req.body;

    const configs = loadConfigs();
    const config=recordForToken(configs,token);

    if (!config) {
      return res.status(404).json({
        error: "Config not found"
      });
    }

    if (!verifyPassword(password, config.passwordHash)) {
      return res.status(401).json({
        error: "Incorrect password"
      });
    }

    // Migrate existing legacy hashes only after a successful password check.
    if (!String(config.passwordHash).startsWith("scrypt:")) {
      config.passwordHash = hashPassword(password);
    }

    config.catalogs = catalogs !== undefined ? catalogs : (config.catalogs || []);
    config.language = language || config.language || "en-US";
    config.rpdbKey = rpdbKey || config.rpdbKey || null;
    config.tpKey = tpKey || config.tpKey || null;
    config.fanartKey = fanartKey || config.fanartKey || null;
    config.omdbKey = omdbKey || config.omdbKey || null;
    config.mdblistKey = mdblistKey || config.mdblistKey || null;
    config.traktUser =
      traktUser !== undefined
        ? traktUser
        : config.traktUser;

    config.excludeUnreleased =
      excludeUnreleased !== undefined
        ? !!excludeUnreleased
        : (config.excludeUnreleased || false);

    config.maxRating =
      maxRating !== undefined
        ? maxRating
        : (config.maxRating || null);

    config.streamAddons = Array.isArray(streamAddons)
      ? streamAddons.filter(Boolean)
      : (config.streamAddons || []);

    config.customCatalogs = Array.isArray(customCatalogs)
      ? customCatalogs.filter(Boolean)
      : (config.customCatalogs || []);

    config.googleAiKey =
      googleAiKey || config.googleAiKey || null;

    config.enableAiRecommended =
      enableAiRecommended !== undefined
        ? !!enableAiRecommended
        : !!config.enableAiRecommended;

    config.hiddenCatalogs = Array.isArray(hiddenCatalogs)
      ? hiddenCatalogs
      : (config.hiddenCatalogs || []);

    config.updatedAt = new Date().toISOString();

    saveConfigs(configs);

    res.json({ token });
  });

  // Public manifest URLs never reveal saved provider credentials.
  app.get("/c/:token/config", (req,res)=>{
    const configs=loadConfigs(),config=recordForToken(configs,req.params.token);
    if(!config) return res.status(404).json({error:"Not found"});
    res.setHeader("Cache-Control","private, no-store");
    return res.json({
      catalogs:config.catalogs || [],language:config.language || "en-US",
      enableAiRecommended:!!config.enableAiRecommended,
      excludeUnreleased:!!config.excludeUnreleased,
      maxRating:config.maxRating || null
    });
  });
  app.post("/c/:token/config/auth",authLimiter,(req,res)=>{
    const configs=loadConfigs(),config=recordForToken(configs,req.params.token);
    if(!config) return res.status(404).json({error:"Not found"});
    if(!verifyPassword(req.body?.password,config.passwordHash))
      return res.status(401).json({error:"Incorrect password"});
    migrateLegacyPassword(config,req.body.password,hashPassword,saveConfigs,configs);
    res.setHeader("Cache-Control","private, no-store");
    res.json({
      catalogs: config.catalogs,
      mdblistKey: config.mdblistKey,
      language: config.language,
      rpdbKey: config.rpdbKey,
      tpKey: config.tpKey,
      fanartKey: config.fanartKey || null,
      omdbKey: config.omdbKey || null,
      traktUser: config.traktUser,
      excludeUnreleased: config.excludeUnreleased || false,
      maxRating: config.maxRating || null,
      streamAddons: config.streamAddons || [],
      customCatalogs: config.customCatalogs || [],
      googleAiKey: config.googleAiKey || null,
      enableAiRecommended: !!config.enableAiRecommended
    });
  });
  app.get("/debug/config/:token", (_req, res) =>
    res.status(410).json({error:"Authenticated debug endpoint required"}));
  app.post("/debug/config/:token", authLimiter, (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();
    const config=recordForToken(configs,token);

    if (!config) {
      return res.status(404).json({ok:false,error:"Config not found"});
    }
    if (!verifyPassword(req.body?.password,config.passwordHash)) {
      return res.status(401).json({error:"Incorrect password"});
    }
    migrateLegacyPassword(config,req.body.password,hashPassword,saveConfigs,configs);
    res.setHeader("Cache-Control","private, no-store");

    const redact = value => {
      if (!value) return null;

      const text = String(value);

      if (text.length <= 6) return "***";

      return `${text.slice(0,3)}...${text.slice(-3)}`;
    };

    const catalogs = Array.isArray(config.catalogs) ? config.catalogs : [];
    const streamAddons = Array.isArray(config.streamAddons) ? config.streamAddons : [];
    const customCatalogs = Array.isArray(config.customCatalogs) ? config.customCatalogs : [];
    const collections = Array.isArray(config.collections) ? config.collections : [];
    const hiddenCatalogs = Array.isArray(config.hiddenCatalogs) ? config.hiddenCatalogs : [];

    res.json({
      ok: true,
      token,
      createdAt: config.createdAt || null,
      updatedAt: config.updatedAt || null,

      counts: {
        catalogs: catalogs.length,
        hiddenCatalogs: hiddenCatalogs.length,
        streamAddons: streamAddons.length,
        customCatalogs: customCatalogs.length,
        collections: collections.length
      },

      settings: {
        language: config.language || "en-US",
        excludeUnreleased: !!config.excludeUnreleased,
        maxRating: config.maxRating || null,
        enableAiRecommended: !!config.enableAiRecommended,
        traktUser: config.traktUser || null
      },

      keys: {
        mdblistKey: redact(config.mdblistKey),
        rpdbKey: redact(config.rpdbKey),
        tpKey: redact(config.tpKey),
        fanartKey: redact(config.fanartKey),
        omdbKey: redact(config.omdbKey),
        googleAiKey: redact(config.googleAiKey)
      }
    });
  });

  app.post("/c/:token/collections", authLimiter, (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();
    const config=recordForToken(configs,token);

    if (!config) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    const { collections, replace, password } = req.body || {};
    const verifiedPassword=password || req.get("x-config-password");
    if (!verifyPassword(verifiedPassword,config.passwordHash)) {
      return res.status(401).json({error:"Password required"});
    }
    migrateLegacyPassword(config,verifiedPassword,hashPassword,saveConfigs,configs);

    if (!Array.isArray(collections) || collections.length>200 || hasUnsafeKeys(collections)) {
      return res.status(400).json({
        error: "Invalid collections"
      });
    }

    const existing = Array.isArray(config.collections)
      ? config.collections
      : [];

    if (replace === true) {
      config.collections = collections;
    } else {
      const keyOf = c =>
        String(
          c.id || c.slug || c.title || c.name || ""
        )
          .trim()
          .toLowerCase();

      const merged = [...existing];
      const seen = new Map();

      merged.forEach((c, i) => {
        const k = keyOf(c);
        if (k) seen.set(k, i);
      });

      for (const incoming of collections) {
        const k = keyOf(incoming);

        if (k && seen.has(k)) {
          merged[seen.get(k)] = {
            ...merged[seen.get(k)],
            ...incoming
          };
        } else {
          if (k) seen.set(k, merged.length);
          merged.push(incoming);
        }
      }

      config.collections = merged;
    }

    saveConfigs(configs);

    res.json({
      ok: true,
      mode: replace === true ? "replace" : "merge",
      before: existing.length,
      incoming: collections.length,
      after: config.collections.length
    });
  });

  app.get("/c/:token/collections.json", (req, res) => {
    const { token } = req.params;
    const configs = loadConfigs();
    const config=recordForToken(configs,token);

    if (!config) {
      return res.status(404).json([]);
    }

    res.json(config.collections || []);
  });
}

module.exports = {
  registerConfigRoutes
};
