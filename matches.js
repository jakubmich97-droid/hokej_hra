const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CURRENT_SEASON = HockeySeason.getCurrentSeason();
const LEAGUE_SIZE = 6;
const LINEUP_POSITIONS = ["C", "LK", "PK", "LO", "PO", "G"];
const ATTACK_POSITIONS = ["C", "LK", "PK"];
const DEFENSE_POSITIONS = ["LO", "PO"];
const BASE_SHOTS = 28;
const SHOT_STRENGTH_MULTIPLIER = 18;
const HOME_SHOT_ADVANTAGE = 1.5;

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
  generateButtons: [...document.querySelectorAll(".generate-btn")],
  simulateNextRoundBtn: document.querySelector("#simulateNextRoundBtn"),
  simulateAllBtn: document.querySelector("#simulateAllBtn")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadMatches() {
  setStatus("Načítám zápasy a týmy...");

  const [teamsResponse, playersResponse, matchesResponse, schemaResponse] = await Promise.all([
    db.from("hockey_teams").select("*").order("name", { ascending: true }),
    db
      .from("hockey_players")
      .select("id, name, team_id, position, current_rating, sort_rating, active")
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
  state.players = playersResponse.data || [];
  state.matches = sortMatches(matchesResponse.data || []);
  state.schemaReady = !schemaResponse.error;

  els.generateButtons.forEach(button => {
    button.disabled = !state.schemaReady || state.simulationBusy || state.generationBusy;
    button.title = state.schemaReady ? "" : "Nejdřív spusť SQL rozšíření hockey_matches.";
  });

  applyFilters();

  setStatus(
    state.schemaReady
      ? "Zápasy načteny. Generátor je připraven."
      : "Zápasy načteny. Pro aktivaci generátoru spusť SQL rozšíření hockey_matches.",
    state.schemaReady ? "ok" : "muted"
  );
}

function applyFilters() {
  const competition = els.filterCompetition.value;
  const category = els.filterCategory.value;

  state.filteredMatches = state.matches.filter(match => {
    const isLeague = match.competition_type === "league";
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
    match => match.competition_type === "league"
  ).length;
  els.nationalMatchesCount.textContent = state.matches.filter(
    match => match.competition_type !== "league"
  ).length;
  els.playedMatchesCount.textContent = state.matches.filter(isMatchPlayed).length;

  updateSimulationButtons();
  renderMatchesTable();
}

function renderMatchesTable() {
  if (!state.filteredMatches.length) {
    els.matchesTable.innerHTML = `
      <tr><td colspan="14">Zatím nebyl vygenerován žádný zápas.</td></tr>
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
        <td><strong>${match.round_number ?? "—"}</strong></td>
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
els.simulateNextRoundBtn.addEventListener("click", simulateNextRound);
els.simulateAllBtn.addEventListener("click", simulateAllRemaining);

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

  if (isLeague && teams.length !== LEAGUE_SIZE) {
    setStatus(
      `Ligový rozpis vyžaduje přesně 6 týmů. Aktuálně je přidáno ${teams.length}.`,
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
        ? "Vygenerováno 10 kol a 30 ligových zápasů."
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
      id: item.match.id,
      result: simulateMatch(item.homeLineup, item.awayLineup, averageGoalieRating)
    }));

    setSimulationBusy(true);
    setStatus(`Simuluji ${label}...`);

    const responses = await Promise.all(simulations.map(simulation =>
      db
        .from("hockey_matches")
        .update(simulation.result)
        .eq("id", simulation.id)
        .is("home_result", null)
        .is("away_result", null)
    ));
    const failedResponse = responses.find(response => response.error);
    if (failedResponse?.error) throw failedResponse.error;

    await loadMatches();
    setStatus(`Odehráno: ${label}.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Zápasy nelze odehrát: ${error.message}`, "error");
  } finally {
    setSimulationBusy(false);
  }
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
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function getAverageGoalieRating() {
  const goalies = state.players.filter(player => player.position === "G" && player.team_id);
  if (!goalies.length) return 0;
  return goalies.reduce((sum, goalie) => sum + Number(goalie.current_rating || 0), 0)
    / goalies.length;
}

function simulateMatch(homeLineup, awayLineup, averageGoalieRating) {
  const homeAttack = getLineupRating(homeLineup, ATTACK_POSITIONS);
  const homeDefense = getLineupRating(homeLineup, DEFENSE_POSITIONS);
  const awayAttack = getLineupRating(awayLineup, ATTACK_POSITIONS);
  const awayDefense = getLineupRating(awayLineup, DEFENSE_POSITIONS);
  const homeGoalie = Number(homeLineup.playersByPosition.get("G").current_rating || 0);
  const awayGoalie = Number(awayLineup.playersByPosition.get("G").current_rating || 0);

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
    homeResult = "V";
    awayResult = "P";
  } else {
    homeResult = "P";
    awayResult = "V";
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
    const competitionOrder = Number(first.competition_type !== "league")
      - Number(second.competition_type !== "league");
    if (competitionOrder) return competitionOrder;

    const categoryOrder = String(first.age_category || "")
      .localeCompare(String(second.age_category || ""));
    if (categoryOrder) return categoryOrder;

    return Number(first.round_number || 0) - Number(second.round_number || 0);
  });
}

function setGeneratorBusy(isBusy) {
  state.generationBusy = isBusy;
  els.generateButtons.forEach(button => {
    button.disabled = isBusy || state.simulationBusy || !state.schemaReady;
  });
  updateSimulationButtons();
}

function renderCompetition(match) {
  if (match.competition_type === "league") {
    return `<span class="competition-tag league">Liga</span>`;
  }

  return `
    <span class="competition-tag national">
      Repre ${escapeHtml(getCategoryLabel(match.age_category))}
    </span>
  `;
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
