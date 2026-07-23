const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const CURRENT_SEASON = 2026;
const category = document.body.dataset.nationalCategory;
const categoryLabel = document.body.dataset.categoryLabel;

const els = {
  statusBox: document.querySelector("#statusBox"),
  nationalTeamsCount: document.querySelector("#nationalTeamsCount"),
  nationalMatchesCount: document.querySelector("#nationalMatchesCount"),
  nationalTeamsGrid: document.querySelector("#nationalTeamsGrid")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadNationalCategory() {
  const [teamsResponse, matchesResponse] = await Promise.all([
    db
      .from("hockey_teams")
      .select("*")
      .eq("team_type", "national")
      .eq("age_category", category)
      .order("name", { ascending: true }),
    db
      .from("hockey_matches")
      .select("id", { count: "exact" })
      .eq("season", CURRENT_SEASON)
      .eq("competition_type", "world_championship")
      .eq("age_category", category)
  ]);

  if (teamsResponse.error) {
    setStatus(`Chyba při načítání reprezentací: ${teamsResponse.error.message}`, "error");
    return;
  }

  const teams = teamsResponse.data || [];
  els.nationalTeamsCount.textContent = teams.length;
  els.nationalMatchesCount.textContent = matchesResponse.error ? "—" : matchesResponse.count || 0;
  renderTeams(teams);

  if (matchesResponse.error && isMissingCompetitionColumns(matchesResponse.error)) {
    setStatus(
      `${categoryLabel}: týmy načteny. Pro zápasy je potřeba spustit SQL rozšíření schématu.`,
      "muted"
    );
    return;
  }

  setStatus(
    teams.length
      ? `${categoryLabel}: načteno reprezentací ${teams.length}.`
      : `${categoryLabel}: zatím není přidaná žádná reprezentace.`,
    teams.length ? "ok" : "muted"
  );
}

function renderTeams(teams) {
  if (!teams.length) {
    els.nationalTeamsGrid.innerHTML = `
      <div class="empty-competition">
        <strong>Zatím bez týmů</strong>
        <span>Reprezentace přidáš na stránce Týmy s kategorií ${escapeHtml(categoryLabel)}.</span>
        <a href="teams.html" class="action-link">Přejít na týmy <span aria-hidden="true">→</span></a>
      </div>
    `;
    return;
  }

  els.nationalTeamsGrid.innerHTML = teams.map(team => `
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
      <p>${escapeHtml(team.country || "")} · ${escapeHtml(categoryLabel)}</p>
    </article>
  `).join("");
}

function isMissingCompetitionColumns(error) {
  return /age_category|column/i.test(String(error?.message || ""));
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadNationalCategory();
