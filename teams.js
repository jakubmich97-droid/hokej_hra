const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  teams: [],
  filteredTeams: []
};

const els = {
  statusBox: document.querySelector("#statusBox"),
  teamForm: document.querySelector("#teamForm"),
  teamShortName: document.querySelector("#teamShortName"),
  logoPreview: document.querySelector("#logoPreview"),
  logoPath: document.querySelector("#logoPath"),

  filterTeamName: document.querySelector("#filterTeamName"),
  filterTeamType: document.querySelector("#filterTeamType"),
  filterAgeCategory: document.querySelector("#filterAgeCategory"),

  teamsCount: document.querySelector("#teamsCount"),
  leagueTeamsCount: document.querySelector("#leagueTeamsCount"),
  nationalTeamsCount: document.querySelector("#nationalTeamsCount"),
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

  const { data, error } = await db
    .from("hockey_teams")
    .select("*")
    .order("team_type", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    setStatus(`Chyba při načítání týmů: ${error.message}`, "error");
    return;
  }

  state.teams = data || [];
  applyFilters();
  setStatus("Týmy načteny.", "ok");
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

  renderTeams();
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

    return `
      <article class="team-card">
        <div class="team-card-head">
          <img
            src="${getTeamLogo(team.short_name)}"
            alt="Logo ${escapeHtml(team.name)}"
            class="team-logo large"
            onerror="this.onerror=null;this.src='images/teams/default.svg'"
          >
          <div>
            <h3>${escapeHtml(team.name)}</h3>
            <span class="tag">${escapeHtml(team.short_name)}</span>
          </div>
        </div>
        <p>${escapeHtml(details)}</p>
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
      `Tým ${changes.name} byl upraven. Logo patří do ${getTeamLogo(changes.short_name)}.`,
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
      `Tým uložen. Logo patří do ${getTeamLogo(shortName)}.`,
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

function updateLogoPreview() {
  const logoPath = getTeamLogo(els.teamShortName.value);

  els.logoPath.textContent = logoPath;
  els.logoPreview.src = logoPath;
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
