const crypto=require("node:crypto");
function registerStatsRoutes(app, { loadConfigs }) {

  // Never put administrative credentials into URLs or access logs.
  app.get("/admin/stats/:secret", (_req,res) => res.status(410).json({error:"Stats moved to authenticated POST"}));
  app.post("/admin/stats", (req, res) => {

const secret=process.env.STATS_SECRET;
const supplied=req.get("x-stats-secret") || "";
if (!secret || secret.length<24 || typeof supplied!=="string") {
  return res.status(403).json({error:"Forbidden"});
}
const expected=crypto.createHash("sha256").update(secret).digest();
const received=crypto.createHash("sha256").update(supplied).digest();
if (!crypto.timingSafeEqual(expected,received)) {
  return res.status(403).json({error:"Forbidden"});
}
    const configs = loadConfigs();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    let active24 = 0;
    let active7 = 0;
    let active30 = 0;

    let newToday = 0;
    let new7 = 0;
    let new30 = 0;

    for (const config of Object.values(configs)) {

      const last = new Date(
        config.lastAccessed ||
        config.updatedAt ||
        config.createdAt
      ).getTime();

      const created = new Date(
        config.createdAt || 0
      ).getTime();

      if (now - last < day) active24++;
      if (now - last < 7 * day) active7++;
      if (now - last < 30 * day) active30++;

      if (now - created < day) newToday++;
      if (now - created < 7 * day) new7++;
      if (now - created < 30 * day) new30++;
    }

    res.json({
      totalInstalls: Object.keys(configs).length,
      active24Hours: active24,
      active7Days: active7,
      active30Days: active30,
      newToday,
      new7Days: new7,
      new30Days: new30
    });

  });

}

module.exports = {
  registerStatsRoutes
};
