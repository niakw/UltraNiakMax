// Shared TV season expansion for configured and unconfigured metadata routes.
const MAX_CONCURRENT_SEASONS = 4;

async function getSeriesVideos({ id, tmdbId, seasons, TMDB_KEY, fetchCached }) {
  const numbers = [...new Set(
    (Array.isArray(seasons) ? seasons : [])
      .map(season => season?.season_number)
      .filter(number => Number.isInteger(number) && number >= 0)
  )];

  const responses = Array(numbers.length).fill(null);
  let cursor = 0;

  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_SEASONS, numbers.length) },
    async () => {
      while (cursor < numbers.length) {
        const index = cursor++;
        try {
          responses[index] = await fetchCached(
            `https://api.themoviedb.org/3/tv/${tmdbId}/season/${numbers[index]}?api_key=${TMDB_KEY}`
          );
        } catch {
          // A missing/unavailable season must not discard the rest of the show.
        }
      }
    }
  ));

  const videos = [];
  responses.forEach((data, index) => {
    if (!data || !Array.isArray(data.episodes)) return;

    for (const episode of data.episodes) {
      if (!Number.isInteger(episode?.episode_number) || episode.episode_number < 0) {
        continue;
      }
      const dateMs = episode.air_date ? Date.parse(episode.air_date) : NaN;
      videos.push({
        id: `${id}:${numbers[index]}:${episode.episode_number}`,
        title: episode.name || `Episode ${episode.episode_number}`,
        season: numbers[index],
        episode: episode.episode_number,
        overview: episode.overview || "",
        thumbnail: episode.still_path
          ? `https://image.tmdb.org/t/p/w300${episode.still_path}`
          : null,
        released: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null
      });
    }
  });

  return videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

module.exports = { getSeriesVideos };
