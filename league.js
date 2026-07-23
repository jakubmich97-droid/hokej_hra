const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const LEAGUE_SIZE = 6;

const els = {
  statusBox: document.querySelector("#statusBox"),
  leagueTeamsCount: document.querySelector("#leagueTeamsCount"),
  leagueTeamsTable: document.querySelector("#leagueTeamsTable")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadLeagueTeams() {
  const { data, error } = await db
    .from("hockey_teams")
    .select("*")
    .eq("team_type", "league")
    .order("name", { ascending: true });

  if (error) {
    setStatus(`Chyba při načítání ligy: ${error.message}`, "error");
    return;
  }

  const teams = data || [];
  els.leagueTeamsCount.textContent = Math.min(teams.length, LEAGUE_SIZE);
  renderLeagueSlots(teams);

  if (teams.length > LEAGUE_SIZE) {
    setStatus(`Liga obsahuje ${teams.length} týmů, ale soutěž má pouze 6 míst.`, "error");
    return;
  }

  setStatus(
    teams.length === LEAGUE_SIZE
      ? "Liga je kompletní a připravená ke generování rozpisu."
      : `Obsazeno ${teams.length} z ${LEAGUE_SIZE} ligových míst.`,
    teams.length === LEAGUE_SIZE ? "ok" : "muted"
  );
}

function renderLeagueSlots(teams) {
  const rows = Array.from({ length: LEAGUE_SIZE }, (_, index) => {
    const team = teams[index];

    if (!team) {
      return `
        <tr class="empty-slot">
          <td>${index + 1}</td>
          <td><strong>Volné místo</strong></td>
          <td>—</td>
          <td>—</td>
          <td><span class="tag off">Čeká na tým</span></td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <span class="team-table-name">
            <img
              src="${getTeamLogo(team.short_name)}"
              alt="Logo ${escapeHtml(team.name)}"
              class="team-logo"
              onerror="this.onerror=null;this.src='images/teams/default.svg'"
            >
            <strong>${escapeHtml(team.name)}</strong>
          </span>
        </td>
        <td>${escapeHtml(team.short_name)}</td>
        <td>${escapeHtml(team.country || "—")}</td>
        <td><span class="tag">Připraven</span></td>
      </tr>
    `;
  });

  els.leagueTeamsTable.innerHTML = rows.join("");
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

loadLeagueTeams();
