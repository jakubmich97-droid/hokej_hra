const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CURRENT_SEASON = 2026;

const state = {
  players: [],
  filteredPlayers: [],
  pendingNationality: ""
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
  playerEditForm: document.querySelector("#playerEditForm")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadPlayers() {
  setStatus("Načítám hráče...");

  const { data, error } = await db
    .from("hockey_players")
    .select("*")
    .neq("position", "G")
    .order("sort_rating", { ascending: false });

  if (error) {
    setStatus(`Chyba při načítání hráčů: ${error.message}`, "error");
    return;
  }

  state.players = data || [];
  applyFilters();

  setStatus("Hráči načteni.", "ok");
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
  els.playersCount.textContent = state.players.length;
  els.activePlayersCount.textContent = state.players.filter(player => player.active).length;
  els.shownPlayersCount.textContent = state.filteredPlayers.length;

  renderPlayersTable();
}

function renderPlayersTable() {
  if (!state.filteredPlayers.length) {
    els.playersTable.innerHTML = `
      <tr>
        <td colspan="11">Nenalezen žádný hráč.</td>
      </tr>
    `;
    return;
  }

  els.playersTable.innerHTML = state.filteredPlayers.map(player => {
    const age = CURRENT_SEASON - Number(player.birth_year);

    return `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>${renderCountry(player.nationality)}</td>
        <td>${player.birth_year}</td>
        <td>${age}</td>
        <td>${escapeHtml(player.position)}</td>
        <td>${formatNumber(player.base_rating, 6)}</td>
        <td>${formatNumber(player.raw_rating, 6)}</td>
        <td>${formatNumber(player.current_rating, 6)}</td>
        <td>${formatNumber(player.sort_rating, 6)}</td>
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
    retired_season: active ? null : retiredSeason
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

els.playerBatchSetupForm.addEventListener("submit", event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const nationality = String(form.get("nationality")).trim();
  const count = Number(form.get("count"));

  if (!nationality || count < 1) {
    setStatus("Vyplň národnost a počet hráčů.", "error");
    return;
  }

  state.pendingNationality = nationality;
  renderPlayerRows(count);
  els.playerBatchForm.classList.remove("hidden");

  setStatus(`Připraveno ${count} řádků pro národnost ${nationality}.`, "ok");
});

els.playerBatchForm.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const rows = [...els.playerRows.querySelectorAll(".player-row")];

    const newPlayers = rows.map((row, index) => {
      const name = row.querySelector('[name="player_name"]').value.trim();
      const birthYear = Number(row.querySelector('[name="birth_year"]').value);
      const position = row.querySelector('[name="position"]').value;

      if (!name || !birthYear || !position) {
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

  els.playerRows.innerHTML = Array.from({ length: count }, (_, index) => `
    <div class="player-row">
      <div class="player-row-label">Hráč ${index + 1}</div>

      <input name="player_name" placeholder="Jméno hráče" required>

      <input
        name="birth_year"
        type="number"
        min="1950"
        max="2100"
        value="2000"
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
