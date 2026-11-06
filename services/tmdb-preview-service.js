async function strictTmdbJson(input) {
  const url=new URL(input);
  if (url.origin!=="https://api.themoviedb.org" ||
      !url.pathname.startsWith("/3/")) throw Error("Unsafe TMDB target");
  const response=await fetch(url.toString(),{
    redirect:"error",signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Error("TMDB response failed");
  return response.json();
}
const previewCache = new Map();

async function handleTmdbPreview(req, res) {
  try {
    const {
      type = 'movie',
      genre = '',
      minRating = '',
      yearFrom = '',
      yearTo = '',
      query = '',
      person = ''
    } = req.query;

    const cacheKey =
      `${type}_${genre}_${minRating}_${yearFrom}_${yearTo}_${query}_${person}`;

    const now = Date.now();

    if (previewCache.has(cacheKey)) {
      const cached = previewCache.get(cacheKey);

      if (now - cached.time < 15 * 60 * 1000) {
        return res.json(cached.data);
      }
    }

    if (!["movie","series"].includes(type) ||
        [query,person].some(x=>typeof x!=="string" || x.length>120)) {
      return res.status(400).json({error:"Invalid preview parameters"});
    }
    const tmdbType = type === 'series' ? 'tv' : 'movie';

    const params = new URLSearchParams({
      api_key: process.env.TMDB_KEY,
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page: '1'
    });

    if (genre) params.append('with_genres', genre);
    if (minRating) params.append('vote_average.gte', minRating);

    if (tmdbType === 'tv') {
      if (yearFrom) {
        params.append('first_air_date.gte', yearFrom + '-01-01');
      }

      if (yearTo) {
        params.append('first_air_date.lte', yearTo + '-12-31');
      }
    } else {
      if (yearFrom) {
        params.append('primary_release_date.gte', yearFrom + '-01-01');
      }

      if (yearTo) {
        params.append('primary_release_date.lte', yearTo + '-12-31');
      }
    }

    let url;
    let j;
    let collection = null;

    if (person) {
      const personParams = new URLSearchParams({
        api_key: process.env.TMDB_KEY,
        query: person,
        include_adult: 'false',
        page: '1'
      });

      const pj = await strictTmdbJson(`https://api.themoviedb.org/3/search/person?${personParams.toString()}`);
      const bestPerson = (pj.results || [])[0];

      if (bestPerson && bestPerson.id) {
        params.append('with_cast', String(bestPerson.id));

        url =
          `https://api.themoviedb.org/3/discover/${tmdbType}?${params.toString()}`;
      } else {
        j = { results: [] };
      }
    }

    if (!j) {
      if (query && tmdbType === 'movie') {
        const collectionParams = new URLSearchParams({
          api_key: process.env.TMDB_KEY,
          query,
          include_adult: 'false',
          page: '1'
        });

        const cj = await strictTmdbJson(`https://api.themoviedb.org/3/search/collection?${collectionParams.toString()}`);

        const q = String(query).toLowerCase().trim();

        collection = (cj.results || []).find(c => {
          const name = String(c.name || '').toLowerCase();

          return (
            name.includes(q) ||
            q.includes(
              name.replace(' collection', '').trim()
            )
          );
        });

        if (collection && collection.id) {
          const fj = await strictTmdbJson(`https://api.themoviedb.org/3/collection/${encodeURIComponent(String(Number(collection.id)))}?api_key=${process.env.TMDB_KEY}`);

          let parts = fj.parts || [];

          parts = parts.sort((a, b) => {
            const da = new Date(a.release_date || '1900-01-01');
            const db = new Date(b.release_date || '1900-01-01');
            return da - db;
          });

          j = { results: parts };
        }
      }

      if (!j) {
        if (query) {
          const searchType = tmdbType === 'tv' ? 'tv' : 'movie';

          const searchParams = new URLSearchParams({
            api_key: process.env.TMDB_KEY,
            query,
            include_adult: 'false',
            page: '1'
          });

          url =
            `https://api.themoviedb.org/3/search/${searchType}?${searchParams.toString()}`;
        } else {
          url =
            `https://api.themoviedb.org/3/discover/${tmdbType}?${params.toString()}`;
        }

        j = await strictTmdbJson(url);
      }
    }

    let rawResults = j.results || [];

    if (query && !person) {
      const q = String(query).toLowerCase().trim();

      const badWords = [
        'ninja',
        'shocking',
        'mockbuster',
        'parody',
        'ripoff',
        'lady'
      ];

      rawResults = rawResults.filter(x => {
        const title = String(
          x.title || x.name || ''
        ).toLowerCase();

        if (q && !title.includes(q)) return false;
        if (badWords.some(b => title.includes(b))) return false;
        if (!x.poster_path) return false;
        if (Number(x.vote_average || 0) <= 0) return false;

        return true;
      });
    }

    const results = rawResults.slice(0, 8).map(x => ({
      title: x.title || x.name,
      poster: x.poster_path
        ? `https://image.tmdb.org/t/p/w342${x.poster_path}`
        : null,
      rating: x.vote_average
    }));

    const payload = {
      results,
      collectionId:
        collection && collection.id
          ? collection.id
          : null
    };

    previewCache.set(cacheKey, {
      time: now,
      data: payload
    });

    return res.json(payload);

  } catch (e) {
    console.error('Preview error:', e);

    return res.status(500).json({
      error: 'preview_failed'
    });
  }
}

module.exports = {
  handleTmdbPreview
};
