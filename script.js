const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";

// POZOR: používáme anon public key. Při RLS disabled je to vhodné jen pro test/prototyp.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CURRENT_SEASON = 2026;

const state = {
  players: [],
  teams: []
};

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  statusBox: document.querySelector("#statusBox"),

  playersCount: document.querySelector("#playersCount"),
  goaliesCount: document.querySelector("#goaliesCount"),
  teamsCount: document.querySelector("#teamsCount"),
  activePlayersCount: document.querySelector("#activePlayersCount"),

  teamsList: document.querySelector("#teamsList"),
  topPlayersList: document.querySelector("#topPlayersList"),
  playersTable: document.querySelector("#playersTable")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadAll() {
  setStatus("Načítám data ze Supabase...");

  const [playersResponse, teamsResponse] = await Promise.all([
    db.from("hockey_players").select("*").order("sort_rating", { ascending: false }),
    db.from("hockey_teams").select("*").order("team_type", { ascending: true }).order("name", { ascending: true })
  ]);

  if (playersResponse.error) throw playersResponse.error;
  if (teamsResponse.error) throw teamsResponse.error;

  state.players = playersResponse.data || [];
  state.teams = teamsResponse.data || [];

  render();
  setStatus("Data načtena.", "ok");
}

function render() {
  const skaters = state.players.filter(player => player.position !== "G");
  const goalies = state.players.filter(player => player.position === "G");

  els.playersCount.textContent = skaters.length;
  els.goaliesCount.textContent = goalies.length;
  els.teamsCount.textContent = state.teams.length;
  els.activePlayersCount.textContent = state.players.filter(player => player.active).length;

  renderTeams();
  renderTopPlayers();
  renderPlayersTable();
}

function renderTeams() {
  if (!state.teams.length) {
    els.teamsList.innerHTML = `<div class="muted">Zatím nejsou vytvořené žádné týmy.</div>`;
    return;
  }

  els.teamsList.innerHTML = state.teams.map(team => {
    const typeLabel = team.team_type === "league" ? "Liga" : "Reprezentace";
    const details = [typeLabel, team.country, team.age_category].filter(Boolean).join(" · ");

    return `
      <div class="item team-list-item">
        <img
          src="${getTeamLogo(team.short_name)}"
          alt="Logo ${escapeHtml(team.name)}"
          class="team-logo"
          onerror="this.onerror=null;this.src='images/teams/default.svg'"
        >
        <div>
          <strong>${escapeHtml(team.short_name)} — ${escapeHtml(team.name)}</strong>
          <small>${escapeHtml(details)}</small>
        </div>
      </div>
    `;
  }).join("");
}

function renderTopPlayers() {
  const topPlayers = [...state.players]
    .filter(player => player.active && player.position !== "G")
    .sort((a, b) => Number(b.sort_rating) - Number(a.sort_rating))
    .slice(0, 8);

  if (!topPlayers.length) {
    els.topPlayersList.innerHTML = `<div class="muted">Zatím nejsou žádní aktivní hráči.</div>`;
    return;
  }

  els.topPlayersList.innerHTML = topPlayers.map((player, index) => `
    <div class="item">
      <strong>#${index + 1} ${escapeHtml(player.name)}</strong>
      <small>
        ${escapeHtml(player.nationality)} · ${escapeHtml(player.position)} · rating ${formatNumber(player.current_rating, 3)}
      </small>
    </div>
  `).join("");
}

function renderPlayersTable() {
  const skaters = state.players.filter(player => player.position !== "G");

  if (!skaters.length) {
    els.playersTable.innerHTML = `<tr><td colspan="10" class="muted">Zatím nejsou žádní hráči.</td></tr>`;
    return;
  }

  els.playersTable.innerHTML = skaters.map(player => {
    const age = CURRENT_SEASON - Number(player.birth_year);

    return `
      <tr>
        <td><strong>${escapeHtml(player.name)}</strong></td>
        <td>${renderCountry(player.nationality)}</td>
        <td>${player.birth_year}</td>
        <td>${age}</td>
        <td>${escapeHtml(player.position)}</td>
        <td>${formatNumber(player.base_rating, 3)}</td>
        <td>${formatNumber(player.raw_rating, 3)}</td>
        <td>${formatNumber(player.current_rating, 3)}</td>
        <td>${formatNumber(player.sort_rating, 6)}</td>
        <td>
          <span class="tag ${player.active ? "" : "off"}">
            ${player.active ? "Aktivní" : "Důchod"}
          </span>
        </td>
      </tr>
    `;
  }).join("");
}

els.refreshBtn.addEventListener("click", async () => {
  try {
    await loadAll();
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při načítání: ${error.message}`, "error");
  }
});


function getAgeModifier(age) {
  const modifiers = {
    15: 0.675, 16: 0.700, 17: 0.725, 18: 0.750, 19: 0.775,
    20: 0.800, 21: 0.825, 22: 0.850, 23: 0.875, 24: 0.900,
    25: 0.925, 26: 0.950, 27: 0.975, 28: 1.000, 29: 0.975,
    30: 0.950, 31: 0.925, 32: 0.900, 33: 0.875, 34: 0.850,
    35: 0.825, 36: 0.800, 37: 0.775, 38: 0.750, 39: 0.725,
    40: 0.700
  };

  if (age < 15) return 0.650;
  if (age > 40) return Math.max(0.400, 0.700 - ((age - 40) * 0.05));

  return modifiers[age] ?? 0.700;
}

function createSortRating(currentRating, seed) {
  return Number(currentRating) + seededMicroValue(seed);
}

function seededMicroValue(seed) {
  let hash = 0;

  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }

  return Math.abs(hash % 100000) / 1000000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

loadAll().catch(error => {
  console.error(error);
  setStatus(`Chyba při prvním načtení: ${error.message}`, "error");
});
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

function getTeamLogo(shortName) {
  const fileName = String(shortName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return fileName
    ? `images/teams/${fileName}.webp`
    : "images/teams/default.svg";
}
