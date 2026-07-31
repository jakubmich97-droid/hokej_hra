(() => {
  const SKATER_WEIGHTS = {
    goals: 0.24,
    assists: 0.2,
    games: 0.11,
    pointsPerGame: 0.4,
    initial: 0.05
  };
  const GOALIE_WEIGHTS = {
    savePercentage: 0.5,
    goalsAgainstAverage: -0.28,
    games: 0.17,
    initial: 0.05
  };
  let pendingRecalculation = null;

  async function recalculate(db) {
    if (pendingRecalculation) return pendingRecalculation;
    pendingRecalculation = runRecalculation(db).finally(() => {
      pendingRecalculation = null;
    });
    return pendingRecalculation;
  }

  async function runRecalculation(db) {
    const [playersResponse, skaterStatsResponse, goalieStatsResponse] = await Promise.all([
      db.from("hockey_players").select("id, name, position, base_rating, raw_rating, current_rating, sort_rating"),
      db.from("hockey_player_stats_season").select("player_id, games, goals, assists, points"),
      db.from("hockey_goalie_stats_season").select("player_id, games, shots_against, goals_against")
    ]);
    if (playersResponse.error) throw playersResponse.error;
    if (skaterStatsResponse.error) throw skaterStatsResponse.error;
    if (goalieStatsResponse.error) throw goalieStatsResponse.error;

    const players = playersResponse.data || [];
    players.forEach(player => {
      if (Number(player.base_rating) < 1 || Number(player.base_rating) > 100) {
        player.base_rating = randomInitialRating();
      }
    });

    const skaterStats = aggregateStats(skaterStatsResponse.data || [], row => ({
      games: Number(row.games || 0),
      goals: Number(row.goals || 0),
      assists: Number(row.assists || 0),
      points: Number(row.points || 0)
    }));
    const goalieStats = aggregateStats(goalieStatsResponse.data || [], row => ({
      games: Number(row.games || 0),
      shotsAgainst: Number(row.shots_against || 0),
      goalsAgainst: Number(row.goals_against || 0)
    }));

    const skaterUpdates = calculateRankedRatings(
      players.filter(player => player.position !== "G"),
      player => {
        const stats = skaterStats.get(String(player.id)) || {
          games: 0, goals: 0, assists: 0, points: 0
        };
        return {
          goals: stats.goals,
          assists: stats.assists,
          games: stats.games,
          pointsPerGame: stats.games ? stats.points / stats.games : 0,
          initial: Number(player.base_rating)
        };
      },
      SKATER_WEIGHTS
    );
    const goalieUpdates = calculateRankedRatings(
      players.filter(player => player.position === "G"),
      player => {
        const stats = goalieStats.get(String(player.id)) || {
          games: 0, shotsAgainst: 0, goalsAgainst: 0
        };
        return {
          savePercentage: stats.shotsAgainst
            ? (stats.shotsAgainst - stats.goalsAgainst) / stats.shotsAgainst
            : 0,
          goalsAgainstAverage: stats.games ? stats.goalsAgainst / stats.games : 99,
          games: stats.games,
          initial: Number(player.base_rating)
        };
      },
      GOALIE_WEIGHTS
    );

    const allUpdates = [...skaterUpdates, ...goalieUpdates];
    assignUniqueSortRatings(allUpdates);

    const playersById = new Map(players.map(player => [String(player.id), player]));
    const changedUpdates = allUpdates.filter(update => {
      const player = playersById.get(String(update.id));
      return !almostEqual(player.base_rating, update.baseRating)
        || !almostEqual(player.raw_rating, update.rawRating)
        || Number(player.current_rating) !== update.currentRating
        || !almostEqual(player.sort_rating, update.sortRating);
    });

    // sort_rating is globally unique in Supabase. Updating directly can collide
    // with another player's old value while the rankings are being reordered.
    // Move every changed row to a unique temporary range first, then write the
    // final values. This also safely repairs a previously interrupted update.
    const temporaryBase = -1_000_000_000
      - Math.floor(Date.now() % 1_000_000) * 1000
      - Math.floor(Math.random() * 500);
    await updateInBatches(changedUpdates, item => ({
      sort_rating: temporaryBase - allUpdates.findIndex(update => update.id === item.id)
    }), db);

    await updateInBatches(changedUpdates, item => ({
      base_rating: item.baseRating,
      raw_rating: item.rawRating,
      current_rating: item.currentRating,
      sort_rating: item.sortRating
    }), db);

    return { total: players.length, updated: changedUpdates.length };
  }

  function assignUniqueSortRatings(updates) {
    [...updates]
      .sort((first, second) =>
        second.currentRating - first.currentRating
        || second.rawRating - first.rawRating
        || String(first.id).localeCompare(String(second.id))
      )
      .forEach((update, index, ordered) => {
        update.sortRating = update.currentRating + (ordered.length - index) / 1000000;
      });
  }

  async function updateInBatches(items, getValues, db) {
    for (let start = 0; start < items.length; start += 20) {
      const responses = await Promise.all(items.slice(start, start + 20).map(item =>
        db.from("hockey_players").update(getValues(item)).eq("id", item.id)
      ));
      const failedResponse = responses.find(response => response.error);
      if (failedResponse?.error) throw failedResponse.error;
    }
  }

  function aggregateStats(rows, project) {
    const totals = new Map();
    rows.forEach(row => {
      const key = String(row.player_id);
      const values = project(row);
      const current = totals.get(key) || Object.fromEntries(
        Object.keys(values).map(name => [name, 0])
      );
      Object.entries(values).forEach(([name, value]) => {
        current[name] += Number(value || 0);
      });
      totals.set(key, current);
    });
    return totals;
  }

  function calculateRankedRatings(players, getMetrics, weights) {
    if (!players.length) return [];
    const entries = players.map(player => ({ player, metrics: getMetrics(player), score: 0 }));

    Object.entries(weights).forEach(([metric, weight]) => {
      const values = entries.map(entry => Number(entry.metrics[metric] || 0));
      const min = Math.min(...values);
      const max = Math.max(...values);
      entries.forEach(entry => {
        const value = Number(entry.metrics[metric] || 0);
        const normalized = max === min ? 0.5 : (value - min) / (max - min);
        entry.score += Math.abs(weight) * (weight < 0 ? 1 - normalized : normalized);
      });
    });

    entries.sort((first, second) =>
      second.score - first.score
      || Number(second.player.base_rating) - Number(first.player.base_rating)
      || String(first.player.name).localeCompare(String(second.player.name), "cs")
    );

    return entries.map((entry, index) => {
      const currentRating = entries.length === 1
        ? 100
        : Math.round(100 - index * 99 / (entries.length - 1));
      return {
        id: entry.player.id,
        baseRating: Number(entry.player.base_rating),
        rawRating: round(1 + entry.score * 99, 3),
        currentRating,
        sortRating: currentRating + (entries.length - index) / 1000000
      };
    });
  }

  function almostEqual(first, second) {
    return Math.abs(Number(first || 0) - Number(second || 0)) < 0.000001;
  }

  function randomInitialRating() {
    return Math.floor(Math.random() * 100) + 1;
  }

  function round(value, decimals) {
    const power = 10 ** decimals;
    return Math.round(Number(value) * power) / power;
  }

  window.HockeyRatings = { recalculate };
})();
