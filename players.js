const SUPABASE_URL = "https://nqvpxopsiiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "SEM_VLOŽ_ANON_KEY";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CURRENT_SEASON = 2026;

const state = {
  players: [],
  pendingNationality: ""
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  playerBatchSetupForm: document.querySelector("#playerBatchSetupForm"),
  playerBatchForm: document.querySelector("#playerBatchForm"),
  playerRows: document.querySelector("#playerRows"),
  playersTable: document.querySelector("#playersTable")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadPlayers() {
  const { data, error } = await db
    .from("hockey_players")
    .select("*")
    .order("sort_rating", { ascending: false });

  if (error) {
    setStatus(`Chyba při načítání hráčů: ${error.message}`, "error");
    return;
  }

  state.players = data || [];
  renderPlayersTable();
}

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

  const rows = [...els.playerRows.querySelectorAll(".player-row")];

  const newPlayers = rows.map((row, index) => {
    const name = row.querySelector('[name="player_name"]').value.trim();
    const birthYear = Number(row.querySelector('[name="birth_year"]').value);
    const position = row.querySelector('[name="position"]').value;

    if (!name || !birthYear || !position) {
      throw new Error(`Řádek ${index + 1} není kompletně vyplněný.`);
    }

    const microRating = generateUniqueMicroRating(
      `${name}|${state.pendingNationality}|${birthYear}|${position}|${Date.now()}|${index}`
    );

    return {
      name,
      nationality: state.pendingNationality,
      birth_year: birthYear,
      position,

      base_rating: microRating,
      raw_rating: microRating,
      current_rating: microRating,
      sort_rating: microRating,

      active: true,
      retired_season: null
    };
  });

  const { error } = await db
    .from("hockey_players")
    .insert(newPlayers);

  if (error) {
    setStatus(`Chyba při ukládání hráčů: ${error.message}`, "error");
    return;
  }

  els.playerBatchForm.reset();
  els.playerRows.innerHTML = "";
  els.playerBatchForm.classList.add("hidden");

  await loadPlayers();

  setStatus(`Uloženo hráčů: ${newPlayers.length}.`, "ok");
});

function renderPlayerRows(count) {
  const positions = ["C", "LK", "PK", "LO", "PO", "G"];

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

function renderPlayersTable() {
  if (!state.players.length) {
    els.playersTable.innerHTML = `
      <tr>
        <td colspan="10">Zatím nejsou žádní hráči.</td>
      </tr>
    `;
    return;
  }

  els.playersTable.innerHTML = state.players.map(player => {
    const age = CURRENT_SEASON - Number(player.birth_year);

    return `
      <tr>
        <td>${escapeHtml(player.name)}</td>
        <td>${escapeHtml(player.nationality)}</td>
        <td>${player.birth_year}</td>
        <td>${age}</td>
        <td>${escapeHtml(player.position)}</td>
        <td>${formatNumber(player.base_rating, 6)}</td>
        <td>${formatNumber(player.raw_rating, 6)}</td>
        <td>${formatNumber(player.current_rating, 6)}</td>
        <td>${formatNumber(player.sort_rating, 6)}</td>
        <td>${player.active ? "Aktivní" : "Důchod"}</td>
      </tr>
    `;
  }).join("");
}

function generateUniqueMicroRating(seed) {
  let value = 0.0000001 + seededMicroValue(seed) * 0.0009999;
  value = round(value, 6);

  const existingRatings = new Set(
    state.players.map(player => Number(player.sort_rating).toFixed(6))
  );

  while (existingRatings.has(value.toFixed(6))) {
    value = round(value + 0.000001, 6);

    if (value > 0.001) {
      value = 0.000001;
    }
  }

  return value;
}

function seededMicroValue(seed) {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }

  return (Math.abs(hash) % 1000000) / 1000000;
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
