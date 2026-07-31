const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const REQUIRED_POSITIONS = ["C", "LK", "PK", "LO", "PO", "G"];

const state = {
  teams: [],
  players: [],
  filteredTeams: []
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  teamForm: document.querySelector("#teamForm"),
  teamShortName: document.querySelector("#teamShortName"),
  teamType: document.querySelector('#teamForm [name="team_type"]'),
  logoPreview: document.querySelector("#logoPreview"),
  logoPath: document.querySelector("#logoPath"),

  filterTeamName: document.querySelector("#filterTeamName"),
  filterTeamType: document.querySelector("#filterTeamType"),
  filterAgeCategory: document.querySelector("#filterAgeCategory"),

  teamsCount: document.querySelector("#teamsCount"),
  leagueTeamsCount: document.querySelector("#leagueTeamsCount"),
  nationalTeamsCount: document.querySelector("#nationalTeamsCount"),
  leagueRosterAlert: document.querySelector("#leagueRosterAlert"),
  seniorRosterAlert: document.querySelector("#seniorRosterAlert"),
  u21RosterAlert: document.querySelector("#u21RosterAlert"),
  u18RosterAlert: document.querySelector("#u18RosterAlert"),
  teamsGrid: document.querySelector("#teamsGrid"),
  teamEditDialog: document.querySelector("#teamEditDialog"),
  teamEditForm: document.querySelector("#teamEditForm")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadTeams() {
  setStatus("Načítám týmy...");

  const [teamsResponse, playersResponse] = await Promise.all([
    db
      .from("hockey_teams")
      .select("*")
      .order("team_type", { ascending: true })
      .order("name", { ascending: true }),
    db
      .from("hockey_players")
      .select("id, team_id, position, active")
      .eq("active", true)
  ]);

  if (teamsResponse.error) {
    setStatus(`Chyba při načítání týmů: ${teamsResponse.error.message}`, "error");
    return;
  }

  if (playersResponse.error) {
    setStatus(`Chyba při načítání soupisek: ${playersResponse.error.message}`, "error");
    return;
  }

  state.teams = teamsResponse.data || [];
  state.players = playersResponse.data || [];
  applyFilters();
  setStatus("Týmy a kontroly soupisek načteny.", "ok");
}

function applyFilters() {
  const search = els.filterTeamName.value.trim().toLowerCase();
  const teamType = els.filterTeamType.value;
  const ageCategory = els.filterAgeCategory.value;

  state.filteredTeams = state.teams.filter(team => {
    const searchableName = `${team.name || ""} ${team.short_name || ""}`.toLowerCase();
    const matchesSearch = !search || searchableName.includes(search);
    const matchesType = !teamType || team.team_type === teamType;
    const matchesCategory = !ageCategory
      || (ageCategory === "none" ? !team.age_category : team.age_category === ageCategory);

    return matchesSearch && matchesType && matchesCategory;
  });

  render();
}

function render() {
  els.teamsCount.textContent = state.teams.length;
  els.leagueTeamsCount.textContent = state.teams.filter(team => team.team_type === "league").length;
  els.nationalTeamsCount.textContent = state.teams.filter(team => team.team_type === "national").length;

  renderRosterAlerts();
  renderTeams();
}

function renderRosterAlerts() {
  const groups = [
    {
      element: els.leagueRosterAlert,
      code: "LGE",
      label: "Ligové týmy",
      teams: state.teams.filter(team => team.team_type === "league")
    },
    {
      element: els.seniorRosterAlert,
      code: "SEN",
      label: "Rep Sen",
      teams: state.teams.filter(team =>
        team.team_type === "national" && team.age_category === "senior"
      )
    },
    {
      element: els.u21RosterAlert,
      code: "U21",
      label: "Rep U21",
      teams: state.teams.filter(team =>
        team.team_type === "national" && team.age_category === "u21"
      )
    },
    {
      element: els.u18RosterAlert,
      code: "U18",
      label: "Rep U18",
      teams: state.teams.filter(team =>
        team.team_type === "national" && team.age_category === "u18"
      )
    }
  ];

  groups.forEach(group => {
    const incompleteTeams = group.teams.filter(team => !getRosterStatus(team).complete);
    const hasTeams = group.teams.length > 0;
    const isComplete = hasTeams && incompleteTeams.length === 0;
    const stateClass = !hasTeams ? "empty" : isComplete ? "ready" : "warning";
    const icon = !hasTeams ? "—" : isComplete ? "✓" : "⚠";
    const message = !hasTeams
      ? "Bez týmů"
      : isComplete
        ? "Všechny soupisky kompletní"
        : `Nekompletní týmy: ${incompleteTeams.length} / ${group.teams.length}`;

    group.element.className = `roster-alert ${stateClass}`;
    group.element.innerHTML = `
      <span class="roster-alert-icon" aria-hidden="true">${icon}</span>
      <span class="roster-alert-copy">
        <small>${group.code}</small>
        <strong>${group.label}</strong>
        <em>${message}</em>
      </span>
    `;
  });
}

function renderTeams() {
  if (!state.filteredTeams.length) {
    els.teamsGrid.innerHTML = `<div class="muted">Nenalezen žádný tým.</div>`;
    return;
  }

  els.teamsGrid.innerHTML = state.filteredTeams.map(team => {
    const typeLabel = team.team_type === "league" ? "Ligový tým" : "Reprezentace";
    const categoryLabel = getCategoryLabel(team.age_category);
    const details = [typeLabel, categoryLabel, team.country].filter(Boolean).join(" · ");
    const rosterStatus = getRosterStatus(team);

    return `
      <article class="team-card ${rosterStatus.complete ? "roster-complete" : "roster-incomplete"}">
        <div class="team-card-head">
          <img
            src="${getTeamVisualPath(team)}"
            alt="${team.team_type === "national" ? "Vlajka" : "Logo"} ${escapeHtml(team.name)}"
            class="team-logo large ${team.team_type === "national" ? "national-flag" : ""}"
            onerror="this.onerror=null;this.src='images/teams/default.svg'"
          >
          <div>
            <h3>${escapeHtml(team.name)}</h3>
            <span class="tag">${escapeHtml(team.short_name)}</span>
          </div>
        </div>
        <p>${escapeHtml(details)}</p>
        <div class="team-roster-check">
          <div class="team-roster-head">
            <strong>Kontrola soupisky</strong>
            <span class="tag ${rosterStatus.complete ? "roster-ready-tag" : "roster-warning-tag"}">
              ${rosterStatus.complete
                ? "Kompletní"
                : `Chybí ${rosterStatus.missingPositions.length}`}
            </span>
          </div>
          <div class="position-checks">
            ${REQUIRED_POSITIONS.map(position => {
              const occupied = rosterStatus.occupiedPositions.has(position);
              return `
                <span class="position-check ${occupied ? "ready" : "missing"}">
                  <b aria-hidden="true">${occupied ? "✓" : "!"}</b>
                  ${position}
                </span>
              `;
            }).join("")}
          </div>
        </div>
        <button
          class="edit-btn"
          type="button"
          data-edit-team="${escapeHtml(team.id)}"
          aria-label="Upravit tým ${escapeHtml(team.name)}"
        >
          Upravit tým
        </button>
      </article>
    `;
  }).join("");
}

function getRosterStatus(team) {
  const occupiedPositions = new Set(
    state.players
      .filter(player => String(player.team_id) === String(team.id))
      .map(player => player.position)
  );
  const missingPositions = REQUIRED_POSITIONS.filter(
    position => !occupiedPositions.has(position)
  );

  return {
    occupiedPositions,
    missingPositions,
    complete: missingPositions.length === 0
  };
}

els.teamsGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-edit-team]");
  if (!button) return;

  const team = state.teams.find(item => String(item.id) === button.dataset.editTeam);
  if (!team) {
    setStatus("Tým se nepodařilo najít.", "error");
    return;
  }

  fillTeamEditForm(team);
  els.teamEditDialog.showModal();
});

els.teamEditForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const id = String(form.get("id"));
  const changes = {
    name: String(form.get("name")).trim(),
    short_name: String(form.get("short_name")).trim().toUpperCase(),
    team_type: String(form.get("team_type")),
    country: String(form.get("country") || "").trim() || null,
    age_category: String(form.get("age_category") || "") || null
  };

  if (!changes.name || !changes.short_name) {
    setStatus("Vyplň název a zkratku týmu.", "error");
    return;
  }

  try {
    setStatus("Ukládám změny týmu...");

    const { error } = await db
      .from("hockey_teams")
      .update(changes)
      .eq("id", id);

    if (error) throw error;

    els.teamEditDialog.close();
    await loadTeams();
    setStatus(
      `Tým ${changes.name} byl upraven. Grafika: ${getTeamVisualPath(changes)}.`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při úpravě týmu: ${error.message}`, "error");
  }
});

els.teamEditDialog.addEventListener("click", event => {
  if (event.target === els.teamEditDialog) {
    els.teamEditDialog.close();
  }
});

els.teamEditDialog.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => els.teamEditDialog.close());
});

els.teamForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(event.target);
  const shortName = String(form.get("short_name")).trim().toUpperCase();

  const newTeam = {
    name: String(form.get("name")).trim(),
    short_name: shortName,
    team_type: String(form.get("team_type")),
    country: String(form.get("country") || "").trim() || null,
    age_category: String(form.get("age_category") || "") || null
  };

  try {
    setStatus("Ukládám tým...");

    const { error } = await db
      .from("hockey_teams")
      .insert(newTeam);

    if (error) throw error;

    event.target.reset();
    updateLogoPreview();
    await loadTeams();

    setStatus(
      `Tým uložen. Grafika: ${getTeamVisualPath(newTeam)}.`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setStatus(`Chyba při ukládání týmu: ${error.message}`, "error");
  }
});

[
  els.filterTeamName,
  els.filterTeamType,
  els.filterAgeCategory
].forEach(input => {
  input.addEventListener("input", applyFilters);
  input.addEventListener("change", applyFilters);
});

els.teamShortName.addEventListener("input", updateLogoPreview);
els.teamType.addEventListener("change", updateLogoPreview);

function updateLogoPreview() {
  const isNational = els.teamType.value === "national";
  const logoPath = getTeamVisualPath({
    short_name: els.teamShortName.value,
    team_type: els.teamType.value
  });

  els.logoPath.textContent = logoPath;
  els.logoPreview.src = logoPath;
  els.logoPreview.alt = isNational ? "Náhled národní vlajky" : "Náhled loga týmu";
  els.logoPreview.classList.toggle("national-flag", isNational);
  els.logoPreview.onerror = () => {
    els.logoPreview.onerror = null;
    els.logoPreview.src = "images/teams/default.svg";
  };
}

function fillTeamEditForm(team) {
  const form = els.teamEditForm.elements;

  form.id.value = team.id;
  form.name.value = team.name || "";
  form.short_name.value = team.short_name || "";
  form.team_type.value = team.team_type || "league";
  form.age_category.value = team.age_category || "";
  form.country.value = team.country || "";
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

function getNationalFlag(shortName) {
  const countryCode = String(shortName || "").trim().toLowerCase();
  return countryCode
    ? `images/flags/${countryCode}.webp`
    : "images/teams/default.svg";
}

function getTeamVisualPath(team) {
  return team.team_type === "national"
    ? getNationalFlag(team.short_name)
    : getTeamLogo(team.short_name);
}

function getCategoryLabel(category) {
  const labels = {
    senior: "Senior",
    u21: "U21",
    u18: "U18"
  };

  return labels[category] || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

updateLogoPreview();
loadTeams();
