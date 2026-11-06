const test = require("node:test");
const assert = require("node:assert/strict");
const { handleMetaRequest } = require("../services/meta-handler-service");
const { handleConfiguredMeta } = require("../services/meta-route-service");

function fixture({ failSeason = null } = {}) {
  const calls = [];
  async function fetchCached(url) {
    calls.push(url);
    if (url.includes("/find/")) return { tv_results: [{ id: 4242 }], movie_results: [] };
    if (/\/tv\/4242\?/.test(url)) {
      return {
        name: "Test series",
        first_air_date: "2020-01-01",
        seasons: [
          { season_number: -1 },
          { season_number: 2 },
          { season_number: 0 },
          { season_number: 1 },
          { season_number: null },
          { season_number: "0" }
        ]
      };
    }
    const match = url.match(/\/season\/(\d+)/);
    if (match) {
      const season = Number(match[1]);
      if (season === failSeason) throw new Error("Temporary TMDB error");
      return {
        episodes: [
          { episode_number: 2, name: "Second", air_date: "2020-01-02" },
          { episode_number: 1, name: season === 0 ? "Special" : "First", air_date: null }
        ]
      };
    }
    throw new Error("Unexpected URL: " + url);
  }
  return { calls, fetchCached };
}

for (const [name, run] of [
  ["default meta handler", async f => handleMetaRequest(
    { id: "tt1234567", type: "series" }, { TMDB_KEY: "test", fetchCached: f.fetchCached }
  )],
  ["configured meta route", async f => {
    let output;
    await handleConfiguredMeta(
      { params: { token: "config", id: "tt1234567", type: "series" } },
      { json(value) { output = value; return value; } },
      { loadConfigs: () => ({ config: { language: "fr-FR" } }), TMDB_KEY: "test", fetchCached: f.fetchCached }
    );
    return output;
  }]
]) {
  test(name + " preserves Season 0 specials, episode IDs and order", async () => {
    const f = fixture();
    const { meta } = await run(f);
    assert.deepEqual(meta.videos.map(v => v.id), [
      "tt1234567:0:1", "tt1234567:0:2",
      "tt1234567:1:1", "tt1234567:1:2",
      "tt1234567:2:1", "tt1234567:2:2"
    ]);
    assert.equal(meta.videos[0].title, "Special");
    assert.equal(meta.videos[0].released, null);
    assert.equal(f.calls.filter(url => url.includes("/season/")).length, 3);
  });

  test(name + " keeps other seasons when one season request fails", async () => {
    const f = fixture({ failSeason: 2 });
    const { meta } = await run(f);
    assert.deepEqual([...new Set(meta.videos.map(v => v.season))], [0, 1]);
  });
}
