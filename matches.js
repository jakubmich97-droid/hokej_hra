const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CURRENT_SEASON = 2026;
const LEAGUE_SIZE = 6;

const state = {
  teams: [],
  matches: [],
  filteredMatches: [],
  schemaReady: false
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  matchesCount: document.querySelector("#matchesCount"),
  leagueMatchesCount: document.querySelector("#leagueMatchesCount"),
  nationalMatchesCount: document.querySelector("#nationalMatchesCount"),
  matchesTable: document.querySelector("#matchesTable"),
  filterCompetition: document.querySelector("#filterCompetition"),
  filterCategory: document.querySelector("#filterCategory"),
  refreshMatchesBtn: document.querySelector("#refreshMatchesBtn"),
  generateButtons: [...document.querySelectorAll(".generate-btn")]
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadMatches() {
  setStatus("Načítám zápasy a týmy...");

  const [teamsResponse, matchesResponse, schemaResponse] = await Promise.all([
    db.from("hockey_teams").select("*").order("name", { ascending: true }),
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

  state.teams = teamsResponse.data || [];
  state.matches = sortMatches(matchesResponse.data || []);
  state.schemaReady = !schemaResponse.error;

  els.generateButtons.forEach(button => {
    button.disabled = !state.schemaReady;
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

    return `
      <tr>
        <td>${renderCompetition(match)}</td>
        <td><strong>${match.round_number ?? "—"}</strong></td>
        <td>${renderTeamName(homeTeam)}</td>
        <td>${renderTeamName(awayTeam)}</td>
        <td>${formatOptionalNumber(match.home_attack, 3)}</td>
        <td>${formatOptionalNumber(match.home_defense, 3)}</td>
        <td>${formatOptionalNumber(match.away_attack, 3)}</td>
        <td>${formatOptionalNumber(match.away_defense, 3)}</td>
        <td>${formatOptionalNumber(match.home_shots, 0)}</td>
        <td>${formatOptionalNumber(match.away_shots, 0)}</td>
        <td>${formatOptionalNumber(match.home_goals, 0)}</td>
        <td>${formatOptionalNumber(match.away_goals, 0)}</td>
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

[
  els.filterCompetition,
  els.filterCategory
].forEach(input => {
  input.addEventListener("input", applyFilters);
  input.addEventListener("change", applyFilters);
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
    home_shots: null,
    away_shots: null,
    home_goals: null,
    away_goals: null,
    home_result: null,
    away_result: null,
    played_at: null
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
  els.generateButtons.forEach(button => {
    button.disabled = isBusy || !state.schemaReady;
  });
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
