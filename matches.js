const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CURRENT_SEASON = HockeySeason.getCurrentSeason();
const leagueSettings = HockeyLeagueSettings.get();
const LINEUP_POSITIONS = ["C", "LK", "PK", "LO", "PO", "G"];
const ATTACK_POSITIONS = ["C", "LK", "PK"];
const DEFENSE_POSITIONS = ["LO", "PO"];
const BASE_SHOTS = 28;
const SHOT_STRENGTH_MULTIPLIER = 18;
const HOME_SHOT_ADVANTAGE = 1.5;
const SKATER_POSITIONS = ["C", "LK", "PK", "LO", "PO"];
const REGULAR_LEAGUE_MATCHES = HockeyLeagueSettings.expectedMatches(leagueSettings.teamCount);

const state = {
  teams: [],
  players: [],
  matches: [],
  filteredMatches: [],
  schemaReady: false,
  generationBusy: false,
  simulationBusy: false
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  matchesCount: document.querySelector("#matchesCount"),
  leagueMatchesCount: document.querySelector("#leagueMatchesCount"),
  nationalMatchesCount: document.querySelector("#nationalMatchesCount"),
  playedMatchesCount: document.querySelector("#playedMatchesCount"),
  matchesTable: document.querySelector("#matchesTable"),
  filterCompetition: document.querySelector("#filterCompetition"),
  filterCategory: document.querySelector("#filterCategory"),
  refreshMatchesBtn: document.querySelector("#refreshMatchesBtn"),
  generatePlayoffBtn: document.querySelector("#generatePlayoffBtn"),
  playoffGeneratorHint: document.querySelector("#playoffGeneratorHint"),
  configuredScheduleTeams: document.querySelector("#configuredScheduleTeams"),
  configuredScheduleRounds: document.querySelector("#configuredScheduleRounds"),
  configuredScheduleMatches: document.querySelector("#configuredScheduleMatches"),
  generateButtons: [...document.querySelectorAll(".generate-btn")],
  simulateNextRoundBtn: document.querySelector("#simulateNextRoundBtn"),
  simulateAllBtn: document.querySelector("#simulateAllBtn")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

function renderLeagueConfiguration() {
  els.configuredScheduleTeams.textContent = leagueSettings.teamCount;
  els.configuredScheduleRounds.textContent = HockeyLeagueSettings.roundCount(leagueSettings.teamCount);
  els.configuredScheduleMatches.textContent = REGULAR_LEAGUE_MATCHES;
}

async function loadMatches({ synchronizeRatings = true } = {}) {
  renderLeagueConfiguration();
  setStatus("Načítám zápasy a týmy...");

  const [teamsResponse, playersResponse, matchesResponse, schemaResponse] = await Promise.all([
    db.from("hockey_teams").select("*").order("name", { ascending: true }),
    db
      .from("hockey_players")
      .select("id, name, team_id, position, base_rating, raw_rating, current_rating, sort_rating, active")
      .eq("active", true),
    db.from("hockey_matches").select("*").eq("season", CURRENT_SEASON),
    db.from("hockey_matches").select("id, round_number").limit(1)
  ]);

  if (teamsResponse.error) {
    setStatus(`Chyba při načítání týmů: ${teamsResponse.error.message}`, "error");
    return;
  }

  if (matchesResponse.error) {
    setStatus(`Chyba při načítání zápasů: ${matchesResponse.error.message}`, "error");
    return;
  }

  if (playersResponse.error) {
    setStatus(`Chyba při načítání soupisek: ${playersResponse.error.message}`, "error");
    return;
  }

  state.teams = teamsResponse.data || [];
  state.players = await initializeMissingRatings(playersResponse.data || []);
  state.matches = sortMatches((matchesResponse.data || []).map(normalizePlayedMatchResult));
  state.schemaReady = !schemaResponse.error;

  els.generateButtons.forEach(button => {
    button.disabled = !state.schemaReady || state.simulationBusy || state.generationBusy;
    button.title = state.schemaReady ? "" : "Nejdřív spusť SQL rozšíření hockey_matches.";
  });
  updatePlayoffButton();

  applyFilters();

  setStatus(
    state.schemaReady
      ? "Zápasy načteny. Generátor je připraven."
      : "Zápasy načteny. Pro aktivaci generátoru spusť SQL rozšíření hockey_matches.",
    state.schemaReady ? "ok" : "muted"
  );

  if (synchronizeRatings) {
    void synchronizeMatchRatings();
  }
}

async function synchronizeMatchRatings() {
  try {
    const result = await HockeyRatings.recalculate(db);
    if (!result.updated) return;

    await loadMatches({ synchronizeRatings: false });
    setStatus(`Ratingy soupisek byly opraveny. Aktualizováno záznamů: ${result.updated}.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(
      `Zápasy jsou načteny, ale ratingy se nepodařilo synchronizovat: ${error.message}`,
      "error"
    );
  }
}

function applyFilters() {
  const competition = els.filterCompetition.value;
  const category = els.filterCategory.value;

  state.filteredMatches = state.matches.filter(match => {
    const isLeague = isLeagueCompetition(match.competition_type);
    const matchesCompetition = !competition
      || (competition === "league" ? isLeague : !isLeague);
    const matchesCategory = !category || match.age_category === category;
    return matchesCompetition && matchesCategory;
  });

  render();
}

function render() {
  els.matchesCount.textContent = state.matches.length;
  els.leagueMatchesCount.textContent = state.matches.filter(
    match => isLeagueCompetition(match.competition_type)
  ).length;
  els.nationalMatchesCount.textContent = state.matches.filter(
    match => !isLeagueCompetition(match.competition_type)
  ).length;
  els.playedMatchesCount.textContent = state.matches.filter(isMatchPlayed).length;

  updateSimulationButtons();
  renderMatchesTable();
}

function renderMatchesTable() {
  if (!state.filteredMatches.length) {
    els.matchesTable.innerHTML = `
      <tr><td colspan="15">Zatím nebyl vygenerován žádný zápas.</td></tr>
    `;
    return;
  }

  const teamsById = new Map(state.teams.map(team => [String(team.id), team]));

  els.matchesTable.innerHTML = state.filteredMatches.map(match => {
    const homeTeam = teamsById.get(String(match.home_team_id));
    const awayTeam = teamsById.get(String(match.away_team_id));
    const played = isMatchPlayed(match);

    return `
      <tr class="${played ? "played-match" : ""}">
        <td>${renderCompetition(match)}</td>
        <td><strong>${renderRound(match)}</strong></td>
        <td>${renderTeamName(homeTeam)}</td>
        <td>${renderTeamName(awayTeam)}</td>
        <td>${played ? formatOptionalNumber(match.home_attack, 3) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.home_defense, 3) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.away_attack, 3) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.away_defense, 3) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.home_shots, 0) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.away_shots, 0) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.home_goals, 0) : "—"}</td>
        <td>${played ? formatOptionalNumber(match.away_goals, 0) : "—"}</td>
        <td>${renderResultCode(match.home_result)}</td>
        <td>${renderResultCode(match.away_result)}</td>
        <td>
          ${played ? `
            <button class="edit-btn reset-match-btn" type="button" data-reset-match="${escapeHtml(match.id)}">
              Resetovat
            </button>
          ` : "—"}
        </td>
      </tr>
    `;
  }).join("");
}

els.generateButtons.forEach(button => {
  button.addEventListener("click", async () => {
    const type = button.dataset.generate;
    const category = button.dataset.category || null;
    await generateSchedule(type, category);
  });
});

els.refreshMatchesBtn.addEventListener("click", loadMatches);
els.generatePlayoffBtn.addEventListener("click", generatePlayoffs);
els.simulateNextRoundBtn.addEventListener("click", simulateNextRound);
els.simulateAllBtn.addEventListener("click", simulateAllRemaining);

els.matchesTable.addEventListener("click", event => {
  const button = event.target.closest("[data-reset-match]");
  if (!button) return;

  const match = state.matches.find(item => String(item.id) === button.dataset.resetMatch);
  if (match) resetMatch(match);
});

[els.filterCategory].forEach(input => {
  input.addEventListener("input", applyFilters);
  input.addEventListener("change", applyFilters);
});

els.filterCompetition.addEventListener("change", () => {
  const leagueOnly = els.filterCompetition.value === "league";
  if (leagueOnly) els.filterCategory.value = "";
  els.filterCategory.disabled = leagueOnly;
  applyFilters();
});

async function generateSchedule(type, category) {
  if (!state.schemaReady) {
    setStatus("Nejdřív spusť SQL rozšíření tabulky hockey_matches.", "error");
    return;
  }

  const isLeague = type === "league";
  const teams = state.teams.filter(team => isLeague
    ? team.team_type === "league"
    : team.team_type === "national" && team.age_category === category
  );

  if (isLeague && teams.length !== leagueSettings.teamCount) {
    setStatus(
      `Nastavení ligy vyžaduje ${leagueSettings.teamCount} týmů, ale v databázi je ${teams.length}. Uprav ligu nebo počet týmů.`,
      "error"
    );
    return;
  }

  if (!isLeague && teams.length < 2) {
    setStatus(
      `Pro kategorii ${getCategoryLabel(category)} jsou potřeba alespoň 2 reprezentace.`,
      "error"
    );
    return;
  }

  const competitionType = isLeague ? "league" : "world_championship";
  const scheduleExists = state.matches.some(match =>
    match.competition_type === competitionType
    && (isLeague || match.age_category === category)
  );

  if (scheduleExists) {
    setStatus(
      isLeague
        ? "Ligový rozpis pro tuto sezónu už existuje."
        : `Rozpis Repre ${getCategoryLabel(category)} pro tuto sezónu už existuje.`,
      "error"
    );
    return;
  }

  const baseSchedule = createRoundRobin(teams);
  const schedule = isLeague
    ? createHomeAndAwaySchedule(baseSchedule)
    : baseSchedule;

  const rows = schedule.map(match => ({
    season: CURRENT_SEASON,
    competition_type: competitionType,
    age_category: isLeague ? null : category,
    round_number: match.round,
    home_team_id: match.home.id,
    away_team_id: match.away.id,
    home_attack: null,
    home_defense: null,
    away_attack: null,
    away_defense: null,
    home_shots: 0,
    away_shots: 0,
    home_goals: 0,
    away_goals: 0,
    home_result: null,
    away_result: null,
    // Původní tabulka vyžaduje played_at. Do simulace jde o technický čas vytvoření rozpisu.
    played_at: new Date().toISOString()
  }));

  try {
    setGeneratorBusy(true);
    setStatus(`Ukládám rozpis: ${rows.length} zápasů...`);

    const { error } = await db
      .from("hockey_matches")
      .insert(rows);

    if (error) throw error;

    await loadMatches();
    setStatus(
      isLeague
        ? `Vygenerováno ${HockeyLeagueSettings.roundCount(leagueSettings.teamCount)} kol a ${rows.length} ligových zápasů.`
        : `Vygenerován rozpis Repre ${getCategoryLabel(category)}: ${rows.length} zápasů.`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při generování rozpisu: ${error.message}`, "error");
  } finally {
    setGeneratorBusy(false);
  }
}

function updatePlayoffButton() {
  const regularMatches = state.matches.filter(match => match.competition_type === "league");
  const playoffExists = state.matches.some(match => isPlayoffMatch(match));
  const regularSeasonComplete = regularMatches.length === REGULAR_LEAGUE_MATCHES
    && regularMatches.every(isMatchPlayed);
  const disabled = !state.schemaReady
    || state.simulationBusy
    || state.generationBusy
    || !regularSeasonComplete
    || playoffExists;

  els.generatePlayoffBtn.disabled = disabled;
  if (playoffExists) {
    els.generatePlayoffBtn.textContent = "Play-off vygenerováno";
    els.playoffGeneratorHint.textContent = "Další zápasy série se doplňují podle výsledků.";
  } else if (regularSeasonComplete) {
    els.generatePlayoffBtn.textContent = "Generovat play-off";
    els.playoffGeneratorHint.textContent = `Postupuje TOP ${leagueSettings.playoffTeamCount}; nejvýše nasazený hraje s nejníže nasazeným.`;
  } else {
    const played = regularMatches.filter(isMatchPlayed).length;
    els.generatePlayoffBtn.textContent = "Generovat play-off";
    els.playoffGeneratorHint.textContent = `Odehráno ${played} z ${REGULAR_LEAGUE_MATCHES} ligových zápasů.`;
  }
}

async function generatePlayoffs() {
  const regularMatches = state.matches.filter(match => match.competition_type === "league");
  if (regularMatches.length !== REGULAR_LEAGUE_MATCHES || !regularMatches.every(isMatchPlayed)) {
    setStatus(`Play-off lze vygenerovat až po odehrání všech ${REGULAR_LEAGUE_MATCHES} ligových zápasů.`, "error");
    return;
  }
  if (state.matches.some(match => isPlayoffMatch(match))) {
    setStatus("Play-off pro tuto sezónu už existuje.", "error");
    return;
  }

  const seeds = calculateLeagueSeeds();
  if (seeds.length < leagueSettings.playoffTeamCount) {
    setStatus(`Pro play-off je potřeba ${leagueSettings.playoffTeamCount} týmů.`, "error");
    return;
  }

  const qualifiedTeams = seeds.slice(0, leagueSettings.playoffTeamCount).map(item => item.team);
  const rows = createPlayoffRound(1, qualifiedTeams);

  try {
    setGeneratorBusy(true);
    setStatus("Generuji první kolo play-off...");
    const { error } = await db.from("hockey_matches").insert(rows);
    if (error) throw error;
    await loadMatches();
    setStatus(`Play-off pro ${qualifiedTeams.length} týmů bylo vygenerováno. Série se hrají na dvě vítězství.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Play-off nelze vygenerovat: ${error.message}`, "error");
  } finally {
    setGeneratorBusy(false);
  }
}

function createPlayoffRound(roundNumber, seededTeams) {
  const rows = [];
  for (let index = 0; index < seededTeams.length / 2; index += 1) {
    const higherSeed = seededTeams[index];
    const lowerSeed = seededTeams[seededTeams.length - 1 - index];
    rows.push(...createSeriesOpeningGames(
      createPlayoffSeriesType(roundNumber, index + 1),
      higherSeed,
      lowerSeed
    ));
  }
  return rows;
}

function createPlayoffSeriesType(roundNumber, seriesNumber) {
  return `league_playoff_r${roundNumber}_s${seriesNumber}`;
}

function parsePlayoffSeriesType(value) {
  const match = String(value || "").match(/^league_playoff_r(\d+)_s(\d+)$/);
  return match ? { round: Number(match[1]), series: Number(match[2]) } : null;
}

function calculateLeagueSeeds() {
  const pointsByResult = { V: 3, VP: 2, PP: 1, P: 0 };
  const standings = new Map(
    state.teams
      .filter(team => team.team_type === "league")
      .map(team => [String(team.id), {
        team, points: 0, goalsFor: 0, goalsAgainst: 0, wins: 0
      }])
  );

  state.matches
    .filter(match => match.competition_type === "league" && isMatchPlayed(match))
    .forEach(match => {
      const home = standings.get(String(match.home_team_id));
      const away = standings.get(String(match.away_team_id));
      if (!home || !away) return;
      home.points += pointsByResult[match.home_result] ?? 0;
      away.points += pointsByResult[match.away_result] ?? 0;
      home.goalsFor += Number(match.home_goals || 0);
      home.goalsAgainst += Number(match.away_goals || 0);
      away.goalsFor += Number(match.away_goals || 0);
      away.goalsAgainst += Number(match.home_goals || 0);
      if (["V", "VP"].includes(match.home_result)) home.wins += 1;
      if (["V", "VP"].includes(match.away_result)) away.wins += 1;
    });

  return [...standings.values()].sort((first, second) =>
    second.points - first.points
    || (second.goalsFor - second.goalsAgainst) - (first.goalsFor - first.goalsAgainst)
    || second.goalsFor - first.goalsFor
    || second.wins - first.wins
    || String(first.team.name).localeCompare(String(second.team.name), "cs")
  );
}

function createSeriesOpeningGames(competitionType, higherSeed, lowerSeed) {
  return [
    createPlayoffRow(competitionType, 1, higherSeed, lowerSeed),
    createPlayoffRow(competitionType, 2, lowerSeed, higherSeed)
  ];
}

function createPlayoffRow(competitionType, gameNumber, homeTeam, awayTeam) {
  return {
    season: CURRENT_SEASON,
    competition_type: competitionType,
    age_category: null,
    round_number: gameNumber,
    home_team_id: homeTeam.id,
    away_team_id: awayTeam.id,
    home_attack: null,
    home_defense: null,
    away_attack: null,
    away_defense: null,
    home_shots: 0,
    away_shots: 0,
    home_goals: 0,
    away_goals: 0,
    home_result: null,
    away_result: null,
    played_at: new Date().toISOString()
  };
}

function isLeagueCompetition(value) {
  return value === "league" || String(value || "").startsWith("league_playoff_");
}

function isPlayoffMatch(match) {
  return String(match.competition_type || "").startsWith("league_playoff_");
}

function isMatchPlayed(match) {
  return Boolean(match.home_result || match.away_result);
}

function getUnplayedFilteredMatches() {
  return state.filteredMatches.filter(match => !isMatchPlayed(match));
}

function updateSimulationButtons() {
  const hasUnplayedMatches = getUnplayedFilteredMatches().length > 0;
  const disabled = !state.schemaReady
    || state.simulationBusy
    || state.generationBusy
    || !hasUnplayedMatches;

  els.simulateNextRoundBtn.disabled = disabled;
  els.simulateAllBtn.disabled = disabled;

  const title = !state.schemaReady
    ? "Nejdřív spusť SQL rozšíření hockey_matches."
    : !hasUnplayedMatches
      ? "Ve vybraném přehledu není žádný neodehraný zápas."
      : "";
  els.simulateNextRoundBtn.title = title;
  els.simulateAllBtn.title = title;
}

async function simulateNextRound() {
  const unplayedMatches = getUnplayedFilteredMatches();
  if (!unplayedMatches.length) return;

  const nextRound = Math.min(...unplayedMatches.map(match => Number(match.round_number || 0)));
  const roundMatches = unplayedMatches.filter(
    match => Number(match.round_number || 0) === nextRound
  );

  await simulateMatches(roundMatches, `kolo ${nextRound}`);
}

async function simulateAllRemaining() {
  const unplayedMatches = getUnplayedFilteredMatches();
  if (!unplayedMatches.length) return;

  const confirmed = window.confirm(
    `Odehrát všechny zbývající zápasy podle aktivních filtrů? Celkem: ${unplayedMatches.length}.`
  );
  if (!confirmed) return;

  await simulateMatches(unplayedMatches, `${unplayedMatches.length} zápasů`);
}

async function simulateMatches(matchesToPlay, label) {
  try {
    const teamsById = new Map(state.teams.map(team => [String(team.id), team]));
    const lineupCache = new Map();
    const preparedMatches = matchesToPlay.map(match => {
      const homeTeam = teamsById.get(String(match.home_team_id));
      const awayTeam = teamsById.get(String(match.away_team_id));

      if (!homeTeam || !awayTeam) {
        throw new Error("U některého zápasu se nepodařilo najít tým.");
      }

      const homeLineup = getCachedLineup(homeTeam, lineupCache);
      const awayLineup = getCachedLineup(awayTeam, lineupCache);

      if (homeLineup.missingPositions.length) {
        throw new Error(
          `${homeTeam.name}: chybí pozice ${homeLineup.missingPositions.join(", ")}.`
        );
      }

      if (awayLineup.missingPositions.length) {
        throw new Error(
          `${awayTeam.name}: chybí pozice ${awayLineup.missingPositions.join(", ")}.`
        );
      }

      return { match, homeLineup, awayLineup };
    });

    const averageGoalieRating = getAverageGoalieRating();
    const simulations = preparedMatches.map(item => ({
      ...item,
      result: simulateMatch(item.homeLineup, item.awayLineup, averageGoalieRating)
    }));

    setSimulationBusy(true);
    setStatus(`Simuluji ${label}...`);

    for (const simulation of simulations) {
      await persistSimulation(simulation);
    }

    await recalculateAllRatings();
    await progressPlayoffs();

    await loadMatches();
    setStatus(`Odehráno: ${label}.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Zápasy nelze odehrát: ${error.message}`, "error");
  } finally {
    setSimulationBusy(false);
  }
}

async function progressPlayoffs() {
  const { data, error } = await db
    .from("hockey_matches")
    .select("*")
    .eq("season", CURRENT_SEASON)
    .like("competition_type", "league_playoff_%");
  if (error) throw error;

  const playoffMatches = data || [];
  if (!playoffMatches.length) return;
  const parsedMatches = playoffMatches
    .map(match => ({ match, series: parsePlayoffSeriesType(match.competition_type) }))
    .filter(item => item.series);
  if (!parsedMatches.length) return;
  const currentRound = Math.max(...parsedMatches.map(item => item.series.round));
  const currentRoundMatches = parsedMatches
    .filter(item => item.series.round === currentRound)
    .map(item => item.match);
  const seriesTypes = [...new Set(currentRoundMatches.map(match => match.competition_type))]
    .sort((first, second) =>
      parsePlayoffSeriesType(first).series - parsePlayoffSeriesType(second).series
    );
  const rowsToInsert = [];
  seriesTypes.forEach(seriesType => {
    const series = getSeriesMatches(playoffMatches, seriesType);
    if (seriesNeedsDecider(series)) {
      rowsToInsert.push(createDecidingGame(seriesType, series));
    }
  });
  if (rowsToInsert.length) {
    const insertResponse = await db.from("hockey_matches").insert(rowsToInsert);
    if (insertResponse.error) throw insertResponse.error;
    return;
  }

  const winners = seriesTypes.map(seriesType =>
    getSeriesWinner(getSeriesMatches(playoffMatches, seriesType))
  );
  if (winners.some(winner => !winner) || winners.length <= 1) return;
  const leagueSeeds = calculateLeagueSeeds().map(item => item.team);
  const advancingTeams = winners
    .map(teamId => state.teams.find(team => String(team.id) === String(teamId)))
    .filter(Boolean)
    .sort((first, second) =>
      leagueSeeds.findIndex(team => String(team.id) === String(first.id))
      - leagueSeeds.findIndex(team => String(team.id) === String(second.id))
    );
  const nextRows = createPlayoffRound(currentRound + 1, advancingTeams);
  const insertResponse = await db.from("hockey_matches").insert(nextRows);
  if (insertResponse.error) throw insertResponse.error;
}

function getSeriesMatches(matches, competitionType) {
  return matches
    .filter(match => match.competition_type === competitionType)
    .sort((first, second) => Number(first.round_number) - Number(second.round_number));
}

function getSeriesWinner(matches) {
  const wins = new Map();
  matches.filter(isMatchPlayed).forEach(match => {
    const winnerId = Number(match.home_goals) > Number(match.away_goals)
      ? match.home_team_id
      : match.away_team_id;
    const key = String(winnerId);
    wins.set(key, (wins.get(key) || 0) + 1);
  });
  return [...wins.entries()].find(([, winCount]) => winCount >= 2)?.[0] || null;
}

function seriesNeedsDecider(matches) {
  return matches.length === 2
    && matches.every(isMatchPlayed)
    && !getSeriesWinner(matches);
}

function createDecidingGame(competitionType, matches) {
  const firstGame = matches[0];
  const homeTeam = state.teams.find(team => String(team.id) === String(firstGame.home_team_id));
  const awayTeam = state.teams.find(team => String(team.id) === String(firstGame.away_team_id));
  return createPlayoffRow(competitionType, 3, homeTeam, awayTeam);
}

async function persistSimulation(simulation) {
  const { match, homeLineup, awayLineup, result } = simulation;
  const scope = isLeagueCompetition(match.competition_type) ? "league" : "national";
  const playerRows = [
    ...createSkaterStatsRows(match, homeLineup, result.home_shots, result.home_goals, scope),
    ...createSkaterStatsRows(match, awayLineup, result.away_shots, result.away_goals, scope)
  ];
  const goalieRows = [
    createGoalieStatsRow(
      match,
      homeLineup,
      result.away_shots,
      result.away_goals,
      scope
    ),
    createGoalieStatsRow(
      match,
      awayLineup,
      result.home_shots,
      result.home_goals,
      scope
    )
  ];

  await clearMatchStats(match.id);

  try {
    const [playersResponse, goaliesResponse] = await Promise.all([
      db.from("hockey_player_match_stats").insert(playerRows),
      db.from("hockey_goalie_match_stats").insert(goalieRows)
    ]);
    if (playersResponse.error) throw playersResponse.error;
    if (goaliesResponse.error) throw goaliesResponse.error;

    const { error } = await db
      .from("hockey_matches")
      .update(result)
      .eq("id", match.id)
      .is("home_result", null)
      .is("away_result", null);
    if (error) throw error;
  } catch (error) {
    await clearMatchStats(match.id);
    throw error;
  }
}

function createSkaterStatsRows(match, lineup, shots, goals, scope) {
  const skaters = SKATER_POSITIONS.map(position => lineup.playersByPosition.get(position));
  const stats = skaters.map(player => ({
    player,
    shots: 0,
    goals: 0,
    assists: 0
  }));
  const goalEvents = [];

  for (let goal = 0; goal < goals; goal += 1) {
    const scorerIndex = weightedIndex(stats, item => playerEventWeight(item.player, "goal"));
    stats[scorerIndex].goals += 1;
    stats[scorerIndex].shots += 1;
    goalEvents.push(scorerIndex);
  }

  for (let shot = goals; shot < shots; shot += 1) {
    const shooterIndex = weightedIndex(stats, item => playerEventWeight(item.player, "shot"));
    stats[shooterIndex].shots += 1;
  }

  goalEvents.forEach(scorerIndex => {
    const assistCountRoll = Math.random();
    const assistCount = assistCountRoll < 0.12 ? 0 : assistCountRoll < 0.48 ? 1 : 2;
    const available = stats
      .map((item, index) => ({ item, index }))
      .filter(entry => entry.index !== scorerIndex);

    for (let assist = 0; assist < assistCount && available.length; assist += 1) {
      const selectedIndex = weightedIndex(available, entry => playerEventWeight(entry.item.player, "assist"));
      const [selected] = available.splice(selectedIndex, 1);
      selected.item.assists += 1;
    }
  });

  return stats.map(item => ({
    match_id: match.id,
    player_id: item.player.id,
    team_id: lineup.team.id,
    scope,
    season: Number(match.season),
    games: 1,
    goals: item.goals,
    assists: item.assists,
    shots: item.shots
  }));
}

function createGoalieStatsRow(match, lineup, shotsAgainst, goalsAgainst, scope) {
  return {
    match_id: match.id,
    player_id: lineup.playersByPosition.get("G").id,
    team_id: lineup.team.id,
    scope,
    season: Number(match.season),
    games: 1,
    shots_against: shotsAgainst,
    goals_against: goalsAgainst
  };
}

function playerEventWeight(player, eventType) {
  const positionWeight = {
    goal: { C: 1.2, LK: 1.25, PK: 1.25, LO: 0.65, PO: 0.65 },
    assist: { C: 1.25, LK: 1.05, PK: 1.05, LO: 0.85, PO: 0.85 },
    shot: { C: 1.1, LK: 1.2, PK: 1.2, LO: 0.75, PO: 0.75 }
  };
  return (0.5 + Number(player.current_rating || 1) / 100)
    * (positionWeight[eventType]?.[player.position] || 1);
}

function weightedIndex(items, getWeight) {
  const weights = items.map(item => Math.max(0.001, Number(getWeight(item))));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;

  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return index;
  }

  return weights.length - 1;
}

async function clearMatchStats(matchId) {
  const [playersResponse, goaliesResponse] = await Promise.all([
    db.from("hockey_player_match_stats").delete().eq("match_id", matchId),
    db.from("hockey_goalie_match_stats").delete().eq("match_id", matchId)
  ]);
  if (playersResponse.error) throw playersResponse.error;
  if (goaliesResponse.error) throw goaliesResponse.error;
}

async function resetMatch(match) {
  const teamsById = new Map(state.teams.map(team => [String(team.id), team]));
  const homeTeam = teamsById.get(String(match.home_team_id));
  const awayTeam = teamsById.get(String(match.away_team_id));
  const dependentMatches = getDependentPlayoffMatches(match);
  const dependencyWarning = dependentMatches.length
    ? ` Navazující zápasy play-off (${dependentMatches.length}) budou odstraněny a později vygenerovány znovu podle výsledků.`
    : "";
  const confirmed = window.confirm(
    `Resetovat zápas ${homeTeam?.short_name || homeTeam?.name || "Domácí"} – ${awayTeam?.short_name || awayTeam?.name || "Hosté"}? Výsledek i individuální statistiky budou odstraněny.${dependencyWarning}`
  );
  if (!confirmed) return;

  try {
    setSimulationBusy(true);
    setStatus("Resetuji zápas a přepočítávám ratingy...");
    await removeDependentPlayoffMatches(dependentMatches);
    await clearMatchStats(match.id);

    const { error } = await db.from("hockey_matches").update({
      home_attack: null,
      home_defense: null,
      away_attack: null,
      away_defense: null,
      home_shots: 0,
      away_shots: 0,
      home_goals: 0,
      away_goals: 0,
      home_result: null,
      away_result: null,
      // Sloupec je ve starším schématu povinný; stav rozehranosti určují výsledkové kódy.
      played_at: new Date().toISOString()
    }).eq("id", match.id);
    if (error) throw error;

    await recalculateAllRatings();
    await loadMatches();
    setStatus("Zápas byl resetován a je znovu připraven k odehrání.", "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Zápas nelze resetovat: ${error.message}`, "error");
  } finally {
    setSimulationBusy(false);
  }
}

function getDependentPlayoffMatches(match) {
  const playoffMatches = state.matches.filter(isPlayoffMatch);
  if (match.competition_type === "league") return playoffMatches;
  if (!isPlayoffMatch(match)) return [];

  const currentSeries = parsePlayoffSeriesType(match.competition_type);
  const laterRounds = currentSeries
    ? playoffMatches.filter(item => {
      const parsed = parsePlayoffSeriesType(item.competition_type);
      return parsed && parsed.round > currentSeries.round;
    })
    : [];
  const decidingGame = Number(match.round_number) < 3
    ? playoffMatches.filter(item =>
      item.competition_type === match.competition_type
      && Number(item.round_number) === 3
    )
    : [];
  return [...new Map([...laterRounds, ...decidingGame].map(item => [String(item.id), item])).values()];
}

async function removeDependentPlayoffMatches(matches) {
  if (!matches.length) return;
  for (const match of matches) await clearMatchStats(match.id);
  const { error } = await db
    .from("hockey_matches")
    .delete()
    .in("id", matches.map(match => match.id));
  if (error) throw error;
}

async function recalculateAllRatings() {
  return HockeyRatings.recalculate(db);
}

async function initializeMissingRatings(players) {
  const updates = players
    .filter(player => Number(player.base_rating) < 1 || Number(player.current_rating) < 1)
    .map(player => {
      const initialRating = randomInitialRating();
      Object.assign(player, {
        base_rating: initialRating,
        raw_rating: initialRating,
        current_rating: initialRating,
        sort_rating: initialRating + Math.random() / 1000
      });
      return db.from("hockey_players").update({
        base_rating: player.base_rating,
        raw_rating: player.raw_rating,
        current_rating: player.current_rating,
        sort_rating: player.sort_rating
      }).eq("id", player.id);
    });
  if (!updates.length) return players;
  const responses = await Promise.all(updates);
  const failedResponse = responses.find(response => response.error);
  if (failedResponse?.error) throw failedResponse.error;
  return players;
}

function randomInitialRating() {
  return Math.floor(Math.random() * 100) + 1;
}

function getCachedLineup(team, cache) {
  const key = String(team.id);
  if (!cache.has(key)) cache.set(key, getTeamLineup(team));
  return cache.get(key);
}

function getTeamLineup(team) {
  const teamPlayers = state.players.filter(
    player => String(player.team_id) === String(team.id)
  );
  const playersByPosition = new Map();

  LINEUP_POSITIONS.forEach(position => {
    const bestPlayer = teamPlayers
      .filter(player => player.position === position)
      .sort(comparePlayersByRating)[0];
    if (bestPlayer) playersByPosition.set(position, bestPlayer);
  });

  return {
    team,
    playersByPosition,
    missingPositions: LINEUP_POSITIONS.filter(position => !playersByPosition.has(position))
  };
}

function comparePlayersByRating(first, second) {
  return Number(second.current_rating || 0) - Number(first.current_rating || 0)
    || Number(second.sort_rating || 0) - Number(first.sort_rating || 0)
    || String(first.name).localeCompare(String(second.name), "cs");
}

function getLineupRating(lineup, positions) {
  const ratings = positions.map(position =>
    Number(lineup.playersByPosition.get(position)?.current_rating || 0)
  );
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length / 100;
}

function getAverageGoalieRating() {
  const goalies = state.players.filter(player => player.position === "G" && player.team_id);
  if (!goalies.length) return 0;
  return goalies.reduce((sum, goalie) => sum + Number(goalie.current_rating || 0), 0)
    / goalies.length / 100;
}

function simulateMatch(homeLineup, awayLineup, averageGoalieRating) {
  const homeAttack = getLineupRating(homeLineup, ATTACK_POSITIONS);
  const homeDefense = getLineupRating(homeLineup, DEFENSE_POSITIONS);
  const awayAttack = getLineupRating(awayLineup, ATTACK_POSITIONS);
  const awayDefense = getLineupRating(awayLineup, DEFENSE_POSITIONS);
  const homeGoalie = Number(homeLineup.playersByPosition.get("G").current_rating || 0) / 100;
  const awayGoalie = Number(awayLineup.playersByPosition.get("G").current_rating || 0) / 100;

  let homeShots = generateShots(homeAttack, awayDefense, true);
  let awayShots = generateShots(awayAttack, homeDefense, false);
  let homeGoals = generateGoals(homeShots, awayGoalie, averageGoalieRating);
  let awayGoals = generateGoals(awayShots, homeGoalie, averageGoalieRating);
  let homeResult;
  let awayResult;

  if (homeGoals === awayGoals) {
    const homeOvertimeStrength = homeAttack * 0.55 + homeDefense * 0.1 + homeGoalie * 0.35 + 0.02;
    const awayOvertimeStrength = awayAttack * 0.55 + awayDefense * 0.1 + awayGoalie * 0.35;
    const totalStrength = homeOvertimeStrength + awayOvertimeStrength;
    const homeWinChance = totalStrength > 0
      ? clamp(homeOvertimeStrength / totalStrength, 0.35, 0.65)
      : 0.52;

    if (Math.random() < homeWinChance) {
      homeGoals += 1;
      homeShots += 1;
      homeResult = "VP";
      awayResult = "PP";
    } else {
      awayGoals += 1;
      awayShots += 1;
      homeResult = "PP";
      awayResult = "VP";
    }
  } else if (homeGoals > awayGoals) {
    const oneGoalDifference = homeGoals - awayGoals === 1;
    homeResult = oneGoalDifference ? "VP" : "V";
    awayResult = oneGoalDifference ? "PP" : "P";
  } else {
    const oneGoalDifference = awayGoals - homeGoals === 1;
    homeResult = oneGoalDifference ? "PP" : "P";
    awayResult = oneGoalDifference ? "VP" : "V";
  }

  return {
    home_attack: round(homeAttack, 6),
    home_defense: round(homeDefense, 6),
    away_attack: round(awayAttack, 6),
    away_defense: round(awayDefense, 6),
    home_shots: homeShots,
    away_shots: awayShots,
    home_goals: homeGoals,
    away_goals: awayGoals,
    home_result: homeResult,
    away_result: awayResult,
    played_at: new Date().toISOString()
  };
}

function generateShots(attackRating, opponentDefenseRating, isHome) {
  const expectedShots = BASE_SHOTS
    + SHOT_STRENGTH_MULTIPLIER * (attackRating - opponentDefenseRating)
    + (isHome ? HOME_SHOT_ADVANTAGE : 0);
  return Math.round(clamp(expectedShots + randomNormal(0, 4), 15, 48));
}

function generateGoals(shots, opponentGoalieRating, averageGoalieRating) {
  const goalieFactor = clamp(
    1 - (opponentGoalieRating - averageGoalieRating) * 0.8,
    0.75,
    1.25
  );
  let goals = 0;

  for (let shot = 0; shot < shots; shot += 1) {
    const shotsPerGoal = randomInteger(8, 12);
    const goalProbability = clamp((1 / shotsPerGoal) * goalieFactor, 0.035, 0.2);
    if (Math.random() < goalProbability) goals += 1;
  }

  return goals;
}

function randomNormal(mean, deviation) {
  const first = Math.max(Math.random(), Number.EPSILON);
  const second = Math.random();
  const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return mean + standardNormal * deviation;
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals) {
  const power = 10 ** decimals;
  return Math.round(Number(value) * power) / power;
}

function setSimulationBusy(isBusy) {
  state.simulationBusy = isBusy;
  els.generateButtons.forEach(button => {
    button.disabled = isBusy || state.generationBusy || !state.schemaReady;
  });
  updatePlayoffButton();
  updateSimulationButtons();
}

function createRoundRobin(teams) {
  const rotation = [...teams];
  if (rotation.length % 2 !== 0) rotation.push(null);

  const rounds = [];
  const roundCount = rotation.length - 1;
  const gamesPerRound = rotation.length / 2;

  for (let round = 0; round < roundCount; round += 1) {
    for (let game = 0; game < gamesPerRound; game += 1) {
      const first = rotation[game];
      const second = rotation[rotation.length - 1 - game];
      if (!first || !second) continue;

      const swapHome = (round + game) % 2 !== 0;
      rounds.push({
        round: round + 1,
        home: swapHome ? second : first,
        away: swapHome ? first : second
      });
    }

    rotation.splice(1, 0, rotation.pop());
  }

  return rounds;
}

function createHomeAndAwaySchedule(firstLeg) {
  const firstRoundCount = Math.max(...firstLeg.map(match => match.round));
  const secondLeg = firstLeg.map(match => ({
    round: match.round + firstRoundCount,
    home: match.away,
    away: match.home
  }));

  return [...firstLeg, ...secondLeg];
}

function sortMatches(matches) {
  return [...matches].sort((first, second) => {
    const competitionOrder = getCompetitionOrder(first.competition_type)
      - getCompetitionOrder(second.competition_type);
    if (competitionOrder) return competitionOrder;

    const categoryOrder = String(first.age_category || "")
      .localeCompare(String(second.age_category || ""));
    if (categoryOrder) return categoryOrder;

    return Number(first.round_number || 0) - Number(second.round_number || 0);
  });
}

function normalizePlayedMatchResult(match) {
  if (!isMatchPlayed(match)) return match;
  const homeGoals = Number(match.home_goals || 0);
  const awayGoals = Number(match.away_goals || 0);
  const difference = homeGoals - awayGoals;
  if (difference === 0) return match;

  const oneGoalDifference = Math.abs(difference) === 1;
  return {
    ...match,
    home_result: difference > 0
      ? (oneGoalDifference ? "VP" : "V")
      : (oneGoalDifference ? "PP" : "P"),
    away_result: difference > 0
      ? (oneGoalDifference ? "PP" : "P")
      : (oneGoalDifference ? "VP" : "V")
  };
}

function setGeneratorBusy(isBusy) {
  state.generationBusy = isBusy;
  els.generateButtons.forEach(button => {
    button.disabled = isBusy || state.simulationBusy || !state.schemaReady;
  });
  updatePlayoffButton();
  updateSimulationButtons();
}

function renderCompetition(match) {
  if (match.competition_type === "league") {
    return `<span class="competition-tag league">Liga</span>`;
  }

  if (isPlayoffMatch(match)) {
    return `<span class="competition-tag playoff">Play-off</span>`;
  }

  return `
    <span class="competition-tag national">
      Repre ${escapeHtml(getCategoryLabel(match.age_category))}
    </span>
  `;
}

function renderRound(match) {
  if (!isPlayoffMatch(match)) return match.round_number ?? "—";
  const parsed = parsePlayoffSeriesType(match.competition_type);
  if (!parsed) return `Play-off · ${Number(match.round_number || 0)}. zápas`;
  const totalRounds = Math.log2(leagueSettings.playoffTeamCount);
  const stageName = parsed.round === totalRounds
    ? "Finále"
    : parsed.round === totalRounds - 1
      ? "SF"
      : parsed.round === totalRounds - 2 ? "ČF" : `${parsed.round}. kolo`;
  const stage = parsed.round === totalRounds ? stageName : `${stageName} ${parsed.series}`;
  return `${stage} · ${Number(match.round_number || 0)}. zápas`;
}

function getCompetitionOrder(value) {
  if (value === "league") return 0;
  const parsed = parsePlayoffSeriesType(value);
  if (parsed) return parsed.round * 100 + parsed.series;
  return 10000;
}

function renderTeamName(team) {
  if (!team) return "Neznámý tým";
  return `<strong>${escapeHtml(team.short_name)}</strong> · ${escapeHtml(team.name)}`;
}

function renderResultCode(code) {
  if (!code) return "—";
  return `<span class="result-code result-${escapeHtml(code.toLowerCase())}">${escapeHtml(code)}</span>`;
}

function getCategoryLabel(value) {
  const labels = { senior: "Sen", u21: "U21", u18: "U18" };
  return labels[value] || "";
}

function formatOptionalNumber(value, decimals) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toFixed(decimals);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadMatches();
