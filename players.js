const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CURRENT_SEASON = HockeySeason.getCurrentSeason();
const SKATER_POSITIONS = ["C", "LK", "PK", "LO", "PO"];

const state = {
  players: [],
  teams: [],
  filteredPlayers: [],
  statsRows: [],
  statsRange: "season",
  statsMap: new Map(),
  rankings: new Map(),
  rosterSchemaReady: false,
  pendingNationality: "",
  pendingBirthInputMode: "year"
};

const els = {
  statusBox: document.querySelector("#statusBox"),

  playerBatchSetupForm: document.querySelector("#playerBatchSetupForm"),
  playerBatchForm: document.querySelector("#playerBatchForm"),
  playerRows: document.querySelector("#playerRows"),

  filterName: document.querySelector("#filterName"),
  filterNationality: document.querySelector("#filterNationality"),
  filterPosition: document.querySelector("#filterPosition"),
  filterStatus: document.querySelector("#filterStatus"),

  playersCount: document.querySelector("#playersCount"),
  activePlayersCount: document.querySelector("#activePlayersCount"),
  shownPlayersCount: document.querySelector("#shownPlayersCount"),
  playersTable: document.querySelector("#playersTable"),
  playerEditDialog: document.querySelector("#playerEditDialog"),
  playerEditForm: document.querySelector("#playerEditForm"),
  playerStatsKicker: document.querySelector("#playerStatsKicker"),
  statsRangeButtons: [...document.querySelectorAll("[data-stats-range]")],
  releaseWeakestPlayersBtn: document.querySelector("#releaseWeakestPlayersBtn"),
  assignPlayersBtn: document.querySelector("#assignPlayersBtn")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadPlayers() {
  setStatus("Načítám hráče a statistiky...");

  const [playersResponse, statsResponse, teamsResponse, rosterSchemaResponse] = await Promise.all([
    db
      .from("hockey_players")
      .select("*")
      .neq("position", "G")
      .order("sort_rating", { ascending: false }),
    db
      .from("hockey_player_stats_season")
      .select("player_id, scope, season, games, goals, assists, shots, points, goals_per_game"),
    db
      .from("hockey_teams")
      .select("*")
      .eq("team_type", "league")
      .order("name", { ascending: true }),
    db
      .from("hockey_players")
      .select("id, team_id")
      .limit(1)
  ]);

  if (playersResponse.error) {
    setStatus(`Chyba při načítání hráčů: ${playersResponse.error.message}`, "error");
    return;
  }

  state.players = playersResponse.data || [];
  state.teams = teamsResponse.data || [];
  state.statsRows = statsResponse.data || [];
  state.rosterSchemaReady = !rosterSchemaResponse.error;
  applyFilters();

  if (teamsResponse.error) {
    setStatus(`Hráči načteni, ale týmy se nepodařilo načíst: ${teamsResponse.error.message}`, "error");
    return;
  }

  if (!state.rosterSchemaReady) {
    setStatus(
      "Pro práci se soupiskami spusť v Supabase soubor supabase-hockey-rosters-extension.sql.",
      "error"
    );
    return;
  }

  if (statsResponse.error) {
    setStatus(
      `Hráči načteni, ale statistiky se nepodařilo načíst: ${statsResponse.error.message}`,
      "error"
    );
    return;
  }

  setStatus(`Hráči a statistiky načteni (${getStatsRangeLabel()}).`, "ok");
}

function applyFilters() {
  const name = els.filterName.value.trim().toLowerCase();
  const nationality = els.filterNationality.value.trim().toLowerCase();
  const position = els.filterPosition.value;
  const status = els.filterStatus.value;

  state.filteredPlayers = state.players.filter(player => {
    const matchName = !name || player.name.toLowerCase().includes(name);
    const matchNationality = !nationality || player.nationality.toLowerCase().includes(nationality);
    const matchPosition = !position || player.position === position;

    let matchStatus = true;

    if (status === "active") {
      matchStatus = player.active === true;
    }

    if (status === "retired") {
      matchStatus = player.active === false;
    }

    return matchName && matchNationality && matchPosition && matchStatus;
  });

  render();
}

function render() {
  state.statsMap = aggregatePlayerStats();
  state.rankings = buildPlayerRankings();

  els.playersCount.textContent = state.players.length;
  els.activePlayersCount.textContent = state.players.filter(player => player.active).length;
  els.shownPlayersCount.textContent = state.filteredPlayers.length;
  els.playerStatsKicker.textContent = state.statsRange === "season"
    ? `Active roster · Season ${CURRENT_SEASON}`
    : "Active roster · Total";
  setRosterButtonsBusy(false);

  renderPlayersTable();
}

function renderPlayersTable() {
  if (!state.filteredPlayers.length) {
    els.playersTable.innerHTML = `
      <tr>
        <td colspan="14">Nenalezen žádný hráč.</td>
      </tr>
    `;
    return;
  }

  const displayPlayers = [...state.filteredPlayers].sort((first, second) => {
    const firstRank = state.rankings.get(String(first.id)) ?? Number.MAX_SAFE_INTEGER;
    const secondRank = state.rankings.get(String(second.id)) ?? Number.MAX_SAFE_INTEGER;
    return firstRank - secondRank || String(first.name).localeCompare(String(second.name), "cs");
  });

  els.playersTable.innerHTML = displayPlayers.map(player => {
    const age = CURRENT_SEASON - Number(player.birth_year);
    const stats = state.statsMap.get(String(player.id)) || createEmptyPlayerStats();
    const ranking = state.rankings.get(String(player.id));
    const goalsPerGame = stats.games > 0 ? stats.goals / stats.games : 0;

    return `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>${renderCountry(player.nationality)}</td>
        <td>${player.birth_year}</td>
        <td>${age}</td>
        <td>${escapeHtml(player.position)}</td>
        <td>${renderPlayerTeam(player.team_id)}</td>
        <td>${stats.games}</td>
        <td>${stats.goals}</td>
        <td>${stats.assists}</td>
        <td><strong class="points-value">${stats.points}</strong></td>
        <td>${formatNumber(goalsPerGame, 3)}</td>
        <td>
          ${ranking
            ? `<span class="ranking-badge">#${ranking}</span>`
            : `<span class="ranking-badge empty">—</span>`}
        </td>
        <td>
          <span class="tag ${player.active ? "" : "off"}">
            ${player.active ? "Aktivní" : "Důchod"}
          </span>
        </td>
        <td>
          <button
            class="edit-btn"
            type="button"
            data-edit-player="${escapeHtml(player.id)}"
            aria-label="Upravit hráče ${escapeHtml(player.name)}"
          >
            Upravit
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function aggregatePlayerStats() {
  const totals = new Map();
  const relevantRows = state.statsRange === "season"
    ? state.statsRows.filter(row => Number(row.season) === CURRENT_SEASON)
    : state.statsRows;

  relevantRows.forEach(row => {
    const key = String(row.player_id);
    const current = totals.get(key) || createEmptyPlayerStats();

    current.games += Number(row.games || 0);
    current.goals += Number(row.goals || 0);
    current.assists += Number(row.assists || 0);
    current.shots += Number(row.shots || 0);
    current.points = current.goals + current.assists;
    totals.set(key, current);
  });

  return totals;
}

function buildPlayerRankings() {
  const rankedPlayers = state.players
    .map(player => ({
      player,
      stats: state.statsMap.get(String(player.id)) || createEmptyPlayerStats()
    }))
    .filter(item => item.stats.games > 0)
    .sort((first, second) =>
      second.stats.points - first.stats.points
      || second.stats.goals - first.stats.goals
      || second.stats.assists - first.stats.assists
      || String(first.player.name).localeCompare(String(second.player.name), "cs")
    );

  const rankings = new Map();
  let previousScore = "";
  let previousRank = 0;

  rankedPlayers.forEach((item, index) => {
    const score = `${item.stats.points}|${item.stats.goals}|${item.stats.assists}`;
    const rank = score === previousScore ? previousRank : index + 1;
    rankings.set(String(item.player.id), rank);
    previousScore = score;
    previousRank = rank;
  });

  return rankings;
}

function createEmptyPlayerStats() {
  return {
    games: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    points: 0
  };
}

function getStatsRangeLabel() {
  return state.statsRange === "season" ? `sezóna ${CURRENT_SEASON}` : "Total";
}

function renderPlayerTeam(teamId) {
  const team = state.teams.find(item => String(item.id) === String(teamId));

  if (!team) {
    return `<span class="tag free-agent">Volný</span>`;
  }

  return `
    <span class="roster-team">
      <img
        src="${getTeamLogo(team.short_name)}"
        alt=""
        class="team-logo"
        onerror="this.onerror=null;this.src='images/teams/default.svg'"
      >
      ${escapeHtml(team.short_name || team.name)}
    </span>
  `;
}

function populateTeamSelect(select, selectedTeamId) {
  select.innerHTML = [
    `<option value="">Volný</option>`,
    ...state.teams.map(team => `
      <option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}</option>
    `)
  ].join("");
  select.value = selectedTeamId || "";
  select.disabled = !state.rosterSchemaReady;
}

function setRosterButtonsBusy(busy) {
  const disabled = busy || !state.rosterSchemaReady;
  els.releaseWeakestPlayersBtn.disabled = disabled;
  els.assignPlayersBtn.disabled = disabled;

  if (!state.rosterSchemaReady) {
    const title = "Nejdřív spusť SQL rozšíření soupisek v Supabase.";
    els.releaseWeakestPlayersBtn.title = title;
    els.assignPlayersBtn.title = title;
  } else {
    els.releaseWeakestPlayersBtn.title = "";
    els.assignPlayersBtn.title = "";
  }
}

function comparePlayersByRating(first, second) {
  return Number(second.current_rating || 0) - Number(first.current_rating || 0)
    || Number(second.sort_rating || 0) - Number(first.sort_rating || 0)
    || String(first.name).localeCompare(String(second.name), "cs");
}

els.playersTable.addEventListener("click", event => {
  const button = event.target.closest("[data-edit-player]");
  if (!button) return;

  const player = state.players.find(item => String(item.id) === button.dataset.editPlayer);
  if (!player) {
    setStatus("Hráče se nepodařilo najít.", "error");
    return;
  }

  fillPlayerEditForm(player);
  els.playerEditDialog.showModal();
});

els.playerEditForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const id = String(form.get("id"));
  const active = form.get("active") === "true";
  const retiredSeason = Number(form.get("retired_season")) || null;
  const changes = {
    name: String(form.get("name")).trim(),
    nationality: String(form.get("nationality")).trim().toUpperCase(),
    birth_year: Number(form.get("birth_year")),
    position: String(form.get("position")),
    base_rating: Number(form.get("base_rating")),
    raw_rating: Number(form.get("raw_rating")),
    current_rating: Number(form.get("current_rating")),
    sort_rating: Number(form.get("sort_rating")),
    active,
    retired_season: active ? null : retiredSeason,
    ...(state.rosterSchemaReady
      ? { team_id: active ? String(form.get("team_id") || "") || null : null }
      : {})
  };

  if (!changes.name || changes.nationality.length !== 3) {
    setStatus("Vyplň jméno a třípísmenný kód národnosti.", "error");
    return;
  }

  try {
    setStatus("Ukládám změny hráče...");

    const { error } = await db
      .from("hockey_players")
      .update(changes)
      .eq("id", id);

    if (error) throw error;

    els.playerEditDialog.close();
    await loadPlayers();
    setStatus(`Hráč ${changes.name} byl upraven.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při úpravě hráče: ${error.message}`, "error");
  }
});

els.playerEditDialog.addEventListener("click", event => {
  if (event.target === els.playerEditDialog) {
    els.playerEditDialog.close();
  }
});

els.playerEditDialog.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => els.playerEditDialog.close());
});

els.statsRangeButtons.forEach(button => {
  button.addEventListener("click", () => {
    state.statsRange = button.dataset.statsRange;
    els.statsRangeButtons.forEach(item => {
      item.classList.toggle("active", item === button);
    });
    render();
    setStatus(`Zobrazeny statistiky: ${getStatsRangeLabel()}.`, "ok");
  });
});

els.releaseWeakestPlayersBtn.addEventListener("click", async () => {
  if (!state.rosterSchemaReady) return;

  const leagueTeamIds = new Set(state.teams.map(team => String(team.id)));
  const weakestPlayers = state.teams
    .map(team => state.players
      .filter(player =>
        player.active
        && String(player.team_id) === String(team.id)
        && leagueTeamIds.has(String(player.team_id))
      )
      .sort((first, second) => comparePlayersByRating(second, first))[0]
    )
    .filter(Boolean);

  if (!weakestPlayers.length) {
    setStatus("V ligových týmech není žádný aktivní hráč k propuštění.", "muted");
    return;
  }

  const confirmed = window.confirm(
    `Propustit nejslabšího hráče z každého obsazeného týmu? Celkem: ${weakestPlayers.length}.`
  );
  if (!confirmed) return;

  try {
    setRosterButtonsBusy(true);
    setStatus(`Propouštím hráče: ${weakestPlayers.length}...`);

    const { error } = await db
      .from("hockey_players")
      .update({ team_id: null })
      .in("id", weakestPlayers.map(player => player.id));

    if (error) throw error;

    await loadPlayers();
    setStatus(`Na volnou nohu bylo propuštěno hráčů: ${weakestPlayers.length}.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při propouštění hráčů: ${error.message}`, "error");
  } finally {
    setRosterButtonsBusy(false);
  }
});

els.assignPlayersBtn.addEventListener("click", async () => {
  if (!state.rosterSchemaReady) return;

  const freePlayers = state.players
    .filter(player => player.active && !player.team_id)
    .sort(comparePlayersByRating);
  const assignments = [];

  state.teams.forEach(team => {
    const occupiedPositions = new Set(
      state.players
        .filter(player => player.active && String(player.team_id) === String(team.id))
        .map(player => player.position)
    );

    SKATER_POSITIONS.forEach(position => {
      if (occupiedPositions.has(position)) return;

      const playerIndex = freePlayers.findIndex(player => player.position === position);
      if (playerIndex < 0) return;

      const [player] = freePlayers.splice(playerIndex, 1);
      assignments.push({ player, team });
      occupiedPositions.add(position);
    });
  });

  if (!assignments.length) {
    setStatus("Není koho přiřadit nebo žádnému týmu nechybí dostupná pozice.", "muted");
    return;
  }

  try {
    setRosterButtonsBusy(true);
    setStatus(`Přiřazuji hráče na chybějící pozice: ${assignments.length}...`);

    const responses = await Promise.all(assignments.map(({ player, team }) =>
      db
        .from("hockey_players")
        .update({ team_id: team.id })
        .eq("id", player.id)
    ));
    const failedResponse = responses.find(response => response.error);
    if (failedResponse?.error) throw failedResponse.error;

    await loadPlayers();
    setStatus(`K týmům bylo přiřazeno hráčů: ${assignments.length}.`, "ok");
  } catch (error) {
    console.error(error);
    await loadPlayers();
    setStatus(`Chyba při přiřazování hráčů: ${error.message}`, "error");
  } finally {
    setRosterButtonsBusy(false);
  }
});

els.playerBatchSetupForm.addEventListener("submit", event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const nationality = String(form.get("nationality")).trim();
  const count = Number(form.get("count"));
  const birthInputMode = String(form.get("birth_input_mode"));

  if (!nationality || count < 1) {
    setStatus("Vyplň národnost a počet hráčů.", "error");
    return;
  }

  state.pendingNationality = nationality;
  state.pendingBirthInputMode = birthInputMode;
  renderPlayerRows(count);
  els.playerBatchForm.classList.remove("hidden");

  setStatus(
    `Připraveno ${count} řádků pro národnost ${nationality} · ${
      birthInputMode === "age" ? "zadání věku" : "zadání roku narození"
    }.`,
    "ok"
  );
});

els.playerBatchForm.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const rows = [...els.playerRows.querySelectorAll(".player-row")];

    const newPlayers = rows.map((row, index) => {
      const name = row.querySelector('[name="player_name"]').value.trim();
      const birthValue = Number(row.querySelector('[name="birth_value"]').value);
      const birthYear = state.pendingBirthInputMode === "age"
        ? CURRENT_SEASON - birthValue
        : birthValue;
      const position = row.querySelector('[name="position"]').value;

      if (!name || !birthValue || !position) {
        throw new Error(`Řádek ${index + 1} není kompletně vyplněný.`);
      }

      const sortRating = generateUniqueSortRating(
        `${name}|${state.pendingNationality}|${birthYear}|${position}|${crypto.randomUUID()}`
      );

      return {
        name,
        nationality: state.pendingNationality,
        birth_year: birthYear,
        position,

        base_rating: 0,
        raw_rating: 0,
        current_rating: 0,
        sort_rating: sortRating,

        active: true,
        retired_season: null
      };
    });

    setStatus("Ukládám hráče...");

    const { error } = await db
      .from("hockey_players")
      .insert(newPlayers);

    if (error) {
      throw error;
    }

    els.playerBatchForm.reset();
    els.playerRows.innerHTML = "";
    els.playerBatchForm.classList.add("hidden");

    await loadPlayers();

    setStatus(`Uloženo hráčů: ${newPlayers.length}.`, "ok");
  } catch (error) {
    setStatus(`Chyba při ukládání hráčů: ${error.message}`, "error");
  }
});

[
  els.filterName,
  els.filterNationality,
  els.filterPosition,
  els.filterStatus
].forEach(input => {
  input.addEventListener("input", applyFilters);
  input.addEventListener("change", applyFilters);
});

function renderPlayerRows(count) {
  const positions = ["C", "LK", "PK", "LO", "PO"];
  const usesAge = state.pendingBirthInputMode === "age";
  const birthValue = usesAge ? 20 : CURRENT_SEASON - 20;

  els.playerRows.innerHTML = Array.from({ length: count }, (_, index) => `
    <div class="player-row">
      <div class="player-row-label">Hráč ${index + 1}</div>

      <input name="player_name" placeholder="Jméno hráče" required>

      <input
        name="birth_value"
        type="number"
        min="${usesAge ? 1 : 1900}"
        max="${usesAge ? 100 : CURRENT_SEASON}"
        value="${birthValue}"
        placeholder="${usesAge ? "Věk v letech" : "Rok narození"}"
        aria-label="${usesAge ? "Aktuální věk hráče" : "Rok narození hráče"}"
        required
      >

      <select name="position" required>
        ${positions.map(position => `
          <option value="${position}">${position}</option>
        `).join("")}
      </select>
    </div>
  `).join("");
}

function fillPlayerEditForm(player) {
  const form = els.playerEditForm.elements;

  form.id.value = player.id;
  form.name.value = player.name || "";
  form.nationality.value = player.nationality || "";
  form.birth_year.value = player.birth_year || "";
  form.position.value = player.position || "C";
  populateTeamSelect(form.team_id, player.team_id);
  form.base_rating.value = player.base_rating ?? 0;
  form.raw_rating.value = player.raw_rating ?? 0;
  form.current_rating.value = player.current_rating ?? 0;
  form.sort_rating.value = player.sort_rating ?? 0;
  form.active.value = String(player.active);
  form.retired_season.value = player.retired_season || "";
}

function generateUniqueSortRating(seed) {
  let value = seededRandom(seed);

  const existingRatings = new Set(
    state.players.map(player => Number(player.sort_rating).toFixed(6))
  );

  while (existingRatings.has(value.toFixed(6))) {
    value = seededRandom(`${seed}|${crypto.randomUUID()}`);
  }

  return round(value, 6);
}

function seededRandom(seed) {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }

  const normalized = (Math.abs(hash) % 999999) / 999999;

  return 0.000001 + normalized * 0.999998;
}

function round(value, decimals) {
  const power = 10 ** decimals;
  return Math.round(Number(value) * power) / power;
}

function formatNumber(value, decimals) {
  return Number(value || 0).toFixed(decimals);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTeamLogo(shortName) {
  const fileName = String(shortName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return fileName ? `images/teams/${fileName}.webp` : "images/teams/default.svg";
}

loadPlayers();
function getFlag(countryCode) {
    return `images/flags/${countryCode.toLowerCase()}.webp`;
}
function renderCountry(countryCode) {
    return `
        <span class="country-cell">
            <img
                src="${getFlag(countryCode)}"
                alt="${countryCode}"
                class="flag"
            >
            ${countryCode}
        </span>
    `;
}
