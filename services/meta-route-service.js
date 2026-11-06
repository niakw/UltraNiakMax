const { getSeriesVideos } = require("./season-video-service");
async function handleConfiguredMeta(req, res, deps) {
  const { token, type, id } = req.params;
  const { loadConfigs, fetchCached, TMDB_KEY } = deps;

  const configs = loadConfigs();
  const lang = configs[token]?.language || "en-US";

  try {
    const tmdbType = type === "series" ? "tv" : "movie";

    const findRes = await fetchCached(
      `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );

    const result = findRes[`${tmdbType}_results`]?.[0];

    if (!result) {
      return res.json({ meta: { id, type } });
    }

    const tmdbId = result.id;

    const d = await fetchCached(
      `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits&language=${lang}`
    );

    const castPeople = (d.credits?.cast || [])
      .slice(0, 12)
      .map(person => ({
        name: person.name,
        character: person.character || "",
        image: person.profile_path
          ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
          : null,
        profile: person.profile_path
          ? `https://image.tmdb.org/t/p/w185${person.profile_path}`
          : null
      }));

    const cast = castPeople.map(person => person.name);

    const meta = {
      id,
      imdb_id: id,
      moviedb_id: tmdbId,
      type,
      name: d.title || d.name,
      description: d.overview,
      poster: d.poster_path
        ? `https://image.tmdb.org/t/p/w500${d.poster_path}`
        : null,
      background: d.backdrop_path
        ? `https://image.tmdb.org/t/p/original${d.backdrop_path}`
        : null,
      releaseInfo: d.release_date
        ? d.release_date.split("-")[0]
        : d.first_air_date
          ? d.first_air_date.split("-")[0]
          : null,
      imdbRating: d.vote_average
        ? d.vote_average.toFixed(1)
        : null,
      genres: (d.genres || []).map(g => g.name),
      cast,
      credits: castPeople,
      castImages: castPeople,
      people: castPeople
    };

    if (type === "series") {
      meta.videos = await getSeriesVideos({
        id, tmdbId, seasons: d.seasons, TMDB_KEY, fetchCached
      });
    }

    return res.json({ meta });

  } catch (e) {
    return res.json({ meta: { id, type } });
  }
}

module.exports = {
  handleConfiguredMeta
};
