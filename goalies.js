const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CURRENT_SEASON = 2026;

const state = {
  goalies: [],
  filteredGoalies: [],
  seasonStats: new Map(),
  pendingNationality: ""
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  goalieBatchSetupForm: document.querySelector("#goalieBatchSetupForm"),
  goalieBatchForm: document.querySelector("#goalieBatchForm"),
  goalieRows: document.querySelector("#goalieRows"),
  filterName: document.querySelector("#filterName"),
  filterNationality: document.querySelector("#filterNationality"),
  filterStatus: document.querySelector("#filterStatus"),
  goaliesCount: document.querySelector("#goaliesCount"),
  activeGoaliesCount: document.querySelector("#activeGoaliesCount"),
  shownGoaliesCount: document.querySelector("#shownGoaliesCount"),
  goaliesTable: document.querySelector("#goaliesTable"),
  goalieEditDialog: document.querySelector("#goalieEditDialog"),
  goalieEditForm: document.querySelector("#goalieEditForm")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadGoalies() {
  setStatus("Načítám brankáře a sezónní statistiky...");

  const [goaliesResponse, statsResponse] = await Promise.all([
    db
      .from("hockey_players")
      .select("*")
      .eq("position", "G")
      .order("sort_rating", { ascending: false }),
    db
      .from("hockey_goalie_stats_season")
      .select("player_id, scope, season, games, shots_against, goals_against, save_percentage")
      .eq("season", CURRENT_SEASON)
  ]);

  if (goaliesResponse.error) {
    setStatus(`Chyba při načítání brankářů: ${goaliesResponse.error.message}`, "error");
    return;
  }

  state.goalies = goaliesResponse.data || [];
  state.seasonStats = aggregateSeasonStats(statsResponse.data || []);
  applyFilters();

  if (statsResponse.error) {
    setStatus(
      `Brankáři načteni, ale statistiky se nepodařilo načíst: ${statsResponse.error.message}`,
      "error"
    );
    return;
  }

  setStatus(`Brankáři a statistiky sezóny ${CURRENT_SEASON} načteny.`, "ok");
}

function aggregateSeasonStats(rows) {
  const totals = new Map();

  rows.forEach(row => {
    const key = String(row.player_id);
    const current = totals.get(key) || {
      games: 0,
      shotsAgainst: 0,
      goalsAgainst: 0
    };

    current.games += Number(row.games || 0);
    current.shotsAgainst += Number(row.shots_against || 0);
    current.goalsAgainst += Number(row.goals_against || 0);
    totals.set(key, current);
  });

  return totals;
}

function applyFilters() {
  const name = els.filterName.value.trim().toLowerCase();
  const nationality = els.filterNationality.value.trim().toLowerCase();
  const status = els.filterStatus.value;

  state.filteredGoalies = state.goalies.filter(goalie => {
    const matchesName = !name || String(goalie.name || "").toLowerCase().includes(name);
    const matchesNationality = !nationality
      || String(goalie.nationality || "").toLowerCase().includes(nationality);

    let matchesStatus = true;
    if (status === "active") matchesStatus = goalie.active === true;
    if (status === "retired") matchesStatus = goalie.active === false;

    return matchesName && matchesNationality && matchesStatus;
  });

  render();
}

function render() {
  els.goaliesCount.textContent = state.goalies.length;
  els.activeGoaliesCount.textContent = state.goalies.filter(goalie => goalie.active).length;
  els.shownGoaliesCount.textContent = state.filteredGoalies.length;
  renderGoaliesTable();
}

function renderGoaliesTable() {
  if (!state.filteredGoalies.length) {
    els.goaliesTable.innerHTML = `
      <tr><td colspan="12">Nenalezen žádný brankář.</td></tr>
    `;
    return;
  }

  els.goaliesTable.innerHTML = state.filteredGoalies.map(goalie => {
    const age = CURRENT_SEASON - Number(goalie.birth_year);
    const stats = state.seasonStats.get(String(goalie.id)) || {
      games: 0,
      shotsAgainst: 0,
      goalsAgainst: 0
    };
    const savePercentage = stats.shotsAgainst > 0
      ? ((stats.shotsAgainst - stats.goalsAgainst) / stats.shotsAgainst) * 100
      : null;

    return `
      <tr>
        <td><strong>${escapeHtml(goalie.name)}</strong></td>
        <td>${renderCountry(goalie.nationality)}</td>
        <td>${goalie.birth_year}</td>
        <td>${age}</td>
        <td>${formatNumber(goalie.base_rating, 6)}</td>
        <td>${formatNumber(goalie.current_rating, 6)}</td>
        <td>${stats.games}</td>
        <td>${stats.shotsAgainst}</td>
        <td>${stats.goalsAgainst}</td>
        <td>
          <span class="save-percentage ${getSavePercentageClass(savePercentage)}">
            ${savePercentage === null ? "—" : `${formatNumber(savePercentage, 2)} %`}
          </span>
        </td>
        <td>
          <span class="tag ${goalie.active ? "" : "off"}">
            ${goalie.active ? "Aktivní" : "Důchod"}
          </span>
        </td>
        <td>
          <button
            class="edit-btn"
            type="button"
            data-edit-goalie="${escapeHtml(goalie.id)}"
            aria-label="Upravit brankáře ${escapeHtml(goalie.name)}"
          >
            Upravit
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

els.goalieBatchSetupForm.addEventListener("submit", event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const nationality = String(form.get("nationality")).trim().toUpperCase();
  const count = Number(form.get("count"));

  if (!nationality || count < 1) {
    setStatus("Vyber národnost a počet brankářů.", "error");
    return;
  }

  state.pendingNationality = nationality;
  renderGoalieRows(count);
  els.goalieBatchForm.classList.remove("hidden");
  setStatus(`Připraveno ${count} řádků pro národnost ${nationality}.`, "ok");
});

els.goalieBatchForm.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const rows = [...els.goalieRows.querySelectorAll(".player-row")];
    const newGoalies = rows.map((row, index) => {
      const name = row.querySelector('[name="goalie_name"]').value.trim();
      const birthYear = Number(row.querySelector('[name="birth_year"]').value);

      if (!name || !birthYear) {
        throw new Error(`Řádek ${index + 1} není kompletně vyplněný.`);
      }

      return {
        name,
        nationality: state.pendingNationality,
        birth_year: birthYear,
        position: "G",
        base_rating: 0,
        raw_rating: 0,
        current_rating: 0,
        sort_rating: generateUniqueSortRating(
          `${name}|${state.pendingNationality}|${birthYear}|G|${crypto.randomUUID()}`
        ),
        active: true,
        retired_season: null
      };
    });

    setStatus("Ukládám brankáře...");

    const { error } = await db
      .from("hockey_players")
      .insert(newGoalies);

    if (error) throw error;

    event.target.reset();
    els.goalieRows.innerHTML = "";
    els.goalieBatchForm.classList.add("hidden");
    await loadGoalies();
    setStatus(`Uloženo brankářů: ${newGoalies.length}.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při ukládání brankářů: ${error.message}`, "error");
  }
});

els.goaliesTable.addEventListener("click", event => {
  const button = event.target.closest("[data-edit-goalie]");
  if (!button) return;

  const goalie = state.goalies.find(item => String(item.id) === button.dataset.editGoalie);
  if (!goalie) {
    setStatus("Brankáře se nepodařilo najít.", "error");
    return;
  }

  fillGoalieEditForm(goalie);
  els.goalieEditDialog.showModal();
});

els.goalieEditForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const id = String(form.get("id"));
  const active = form.get("active") === "true";
  const retiredSeason = Number(form.get("retired_season")) || null;
  const changes = {
    name: String(form.get("name")).trim(),
    nationality: String(form.get("nationality")).trim().toUpperCase(),
    birth_year: Number(form.get("birth_year")),
    position: "G",
    base_rating: Number(form.get("base_rating")),
    raw_rating: Number(form.get("raw_rating")),
    current_rating: Number(form.get("current_rating")),
    sort_rating: Number(form.get("sort_rating")),
    active,
    retired_season: active ? null : retiredSeason
  };

  if (!changes.name || changes.nationality.length !== 3) {
    setStatus("Vyplň jméno a třípísmenný kód národnosti.", "error");
    return;
  }

  try {
    setStatus("Ukládám změny brankáře...");

    const { error } = await db
      .from("hockey_players")
      .update(changes)
      .eq("id", id);

    if (error) throw error;

    els.goalieEditDialog.close();
    await loadGoalies();
    setStatus(`Brankář ${changes.name} byl upraven.`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při úpravě brankáře: ${error.message}`, "error");
  }
});

[
  els.filterName,
  els.filterNationality,
  els.filterStatus
].forEach(input => {
  input.addEventListener("input", applyFilters);
  input.addEventListener("change", applyFilters);
});

els.goalieEditDialog.addEventListener("click", event => {
  if (event.target === els.goalieEditDialog) {
    els.goalieEditDialog.close();
  }
});

els.goalieEditDialog.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => els.goalieEditDialog.close());
});

function renderGoalieRows(count) {
  els.goalieRows.innerHTML = Array.from({ length: count }, (_, index) => `
    <div class="player-row goalie-row">
      <div class="player-row-label">Brankář ${index + 1}</div>
      <input name="goalie_name" placeholder="Jméno brankáře" required />
      <input
        name="birth_year"
        type="number"
        min="1950"
        max="2100"
        value="2000"
        required
      />
      <div class="position-lock">G · Brankář</div>
    </div>
  `).join("");
}

function fillGoalieEditForm(goalie) {
  const form = els.goalieEditForm.elements;

  form.id.value = goalie.id;
  form.name.value = goalie.name || "";
  form.nationality.value = goalie.nationality || "";
  form.birth_year.value = goalie.birth_year || "";
  form.base_rating.value = goalie.base_rating ?? 0;
  form.raw_rating.value = goalie.raw_rating ?? 0;
  form.current_rating.value = goalie.current_rating ?? 0;
  form.sort_rating.value = goalie.sort_rating ?? 0;
  form.active.value = String(goalie.active);
  form.retired_season.value = goalie.retired_season || "";
}

function generateUniqueSortRating(seed) {
  let value = seededRandom(seed);
  const existingRatings = new Set(
    state.goalies.map(goalie => Number(goalie.sort_rating).toFixed(6))
  );

  while (existingRatings.has(value.toFixed(6))) {
    value = seededRandom(`${seed}|${crypto.randomUUID()}`);
  }

  return round(value, 6);
}

function seededRandom(seed) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }

  const normalized = (Math.abs(hash) % 999999) / 999999;
  return 0.000001 + normalized * 0.999998;
}

function getSavePercentageClass(value) {
  if (value === null) return "empty";
  if (value >= 92) return "elite";
  if (value < 88) return "low";
  return "";
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

function getFlag(countryCode) {
  return `images/flags/${String(countryCode || "").toLowerCase()}.webp`;
}

function renderCountry(countryCode) {
  return `
    <span class="country-cell">
      <img
        src="${getFlag(countryCode)}"
        alt="${escapeHtml(countryCode)}"
        class="flag"
      >
      ${escapeHtml(countryCode)}
    </span>
  `;
}

loadGoalies();
