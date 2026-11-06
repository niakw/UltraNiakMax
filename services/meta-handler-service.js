const { getSeriesVideos } = require("./season-video-service");
async function handleMetaRequest({ type, id }, deps) {
  const {
    TMDB_KEY,
    fetchCached
  } = deps;

  try {
    const tmdbType = type === "series" ? "tv" : "movie";

    const findRes = await fetchCached(
      `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`
    );

    const result = findRes[`${tmdbType}_results`]?.[0];

    if (!result) {
      return { meta: { id, type } };
    }

    const tmdbId = result.id;

    const d = await fetchCached(
      `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_KEY}&append_to_response=credits`
    );

    if (!d) {
      return { meta: { id, type } };
    }

    const cast = (d.credits?.cast || [])
      .slice(0, 5)
      .map(c => c.name);

    const meta = {
      id,
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
      cast
    };

    if (type === "series" && d.next_episode_to_air) {
      const next = d.next_episode_to_air;

      meta.releaseInfo =
        `${d.first_air_date?.split("-")[0] || ""} - Next: ` +
        `S${next.season_number}E${next.episode_number} ${next.air_date}`;
    }

    if (type === "series") {
      meta.videos = await getSeriesVideos({
        id, tmdbId, seasons: d.seasons, TMDB_KEY, fetchCached
      });
    }

    return { meta };

  } catch (e) {
    return { meta: { id, type } };
  }
}

module.exports = {
  handleMetaRequest
};
