const SUPABASE_URL = "https://nqvpxopsiiagemumfbmc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdnB4b3BzaWlhZ2VtdW1mYm1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTQwNTcsImV4cCI6MjA5NTI3MDA1N30.VQYWGLALTxD84EksKwwUuVh5zfoAkCgenhMRXm3xdMs";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const LEAGUE_SIZE = 6;
const CURRENT_SEASON = HockeySeason.getCurrentSeason();
const RESULT_POINTS = { V: 3, VP: 2, PP: 1, P: 0 };

const els = {
  statusBox: document.querySelector("#statusBox"),
  leagueTeamsCount: document.querySelector("#leagueTeamsCount"),
  leagueTeamsTable: document.querySelector("#leagueTeamsTable"),
  playoffBracket: document.querySelector("#playoffBracket")
};

function setStatus(message, type = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.className = `status ${type}`;
}

async function loadLeagueTeams() {
  const [teamsResponse, matchesResponse] = await Promise.all([
    db
      .from("hockey_teams")
      .select("*")
      .eq("team_type", "league")
      .order("name", { ascending: true }),
    db
      .from("hockey_matches")
      .select("id, competition_type, round_number, home_team_id, away_team_id, home_goals, away_goals, home_result, away_result, played_at")
      .eq("season", CURRENT_SEASON)
  ]);

  if (teamsResponse.error) {
    setStatus(`Chyba při načítání ligy: ${teamsResponse.error.message}`, "error");
    return;
  }

  if (matchesResponse.error) {
    setStatus(`Chyba při načítání ligových zápasů: ${matchesResponse.error.message}`, "error");
    return;
  }

  const teams = teamsResponse.data || [];
  const matches = matchesResponse.data || [];
  const standings = calculateStandings(
    teams,
    matches.filter(match => match.competition_type === "league")
  );
  els.leagueTeamsCount.textContent = Math.min(teams.length, LEAGUE_SIZE);
  renderLeagueSlots(standings);
  renderPlayoffBracket(
    matches.filter(match => String(match.competition_type || "").startsWith("league_playoff_")),
    teams
  );

  if (teams.length > LEAGUE_SIZE) {
    setStatus(`Liga obsahuje ${teams.length} týmů, ale soutěž má pouze 6 míst.`, "error");
    return;
  }

  setStatus(
    teams.length === LEAGUE_SIZE
      ? `Ligová tabulka pro sezónu ${CURRENT_SEASON} je načtená.`
      : `Obsazeno ${teams.length} z ${LEAGUE_SIZE} ligových míst.`,
    teams.length === LEAGUE_SIZE ? "ok" : "muted"
  );
}

function calculateStandings(teams, matches) {
  const standings = new Map(teams.map(team => [String(team.id), {
    team,
    played: 0,
    wins: 0,
    overtimeWins: 0,
    overtimeLosses: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    form: []
  }]));

  matches.filter(isPlayedLeagueMatch).forEach(match => {
    const results = getEffectiveResultCodes(match);
    applyMatchToStanding(
      standings.get(String(match.home_team_id)),
      match.home_goals,
      match.away_goals,
      results.home,
      match
    );
    applyMatchToStanding(
      standings.get(String(match.away_team_id)),
      match.away_goals,
      match.home_goals,
      results.away,
      match
    );
  });

  return [...standings.values()].sort((first, second) =>
    second.points - first.points
    || getGoalDifference(second) - getGoalDifference(first)
    || second.goalsFor - first.goalsFor
    || second.wins - first.wins
    || String(first.team.name).localeCompare(String(second.team.name), "cs")
  );
}

function getEffectiveResultCodes(match) {
  const difference = Number(match.home_goals || 0) - Number(match.away_goals || 0);
  const oneGoalDifference = Math.abs(difference) === 1;
  return {
    home: difference > 0
      ? (oneGoalDifference ? "VP" : "V")
      : (oneGoalDifference ? "PP" : "P"),
    away: difference > 0
      ? (oneGoalDifference ? "PP" : "P")
      : (oneGoalDifference ? "VP" : "V")
  };
}

function isPlayedLeagueMatch(match) {
  return Boolean(match.home_result && match.away_result);
}

function applyMatchToStanding(standing, goalsFor, goalsAgainst, result, match) {
  if (!standing || !Object.hasOwn(RESULT_POINTS, result)) return;

  standing.played += 1;
  standing.goalsFor += Number(goalsFor || 0);
  standing.goalsAgainst += Number(goalsAgainst || 0);
  standing.points += RESULT_POINTS[result];
  if (result === "V") standing.wins += 1;
  if (result === "VP") standing.overtimeWins += 1;
  if (result === "PP") standing.overtimeLosses += 1;
  if (result === "P") standing.losses += 1;
  standing.form.push({
    result,
    playedAt: match.played_at || "",
    round: Number(match.round_number || 0),
    id: String(match.id || "")
  });
}

function getGoalDifference(standing) {
  return standing.goalsFor - standing.goalsAgainst;
}

function renderLeagueSlots(standings) {
  const rows = Array.from({ length: LEAGUE_SIZE }, (_, index) => {
    const standing = standings[index];

    if (!standing) {
      return `
        <tr class="empty-slot">
          <td>${index + 1}</td>
          <td><strong>Volné místo</strong></td>
          ${Array.from({ length: 10 }, () => "<td>—</td>").join("")}
        </tr>
      `;
    }

    const { team } = standing;
    const goalDifference = getGoalDifference(standing);

    return `
      <tr class="${index < 4 ? "playoff-qualified" : "playoff-out"}">
        <td><span class="league-position">${index + 1}</span>${index < 4 ? '<span class="qualified-mark">Q</span>' : ""}</td>
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
        <td>${standing.played}</td>
        <td>${standing.wins}</td>
        <td>${standing.overtimeWins}</td>
        <td>${standing.overtimeLosses}</td>
        <td>${standing.losses}</td>
        <td>${standing.goalsFor}</td>
        <td>${standing.goalsAgainst}</td>
        <td class="goal-difference ${goalDifference > 0 ? "positive" : goalDifference < 0 ? "negative" : ""}">
          ${goalDifference > 0 ? "+" : ""}${goalDifference}
        </td>
        <td><strong class="league-points">${standing.points}</strong></td>
        <td>${renderLastFive(standing.form)}</td>
      </tr>
    `;
  });

  els.leagueTeamsTable.innerHTML = rows.join("");
}

function renderPlayoffBracket(matches, teams) {
  if (!matches.length) {
    els.playoffBracket.innerHTML = `
      <p class="playoff-empty">Play-off zatím nebylo vygenerováno. Po základní části postoupí první čtyři týmy.</p>
    `;
    return;
  }

  const teamsById = new Map(teams.map(team => [String(team.id), team]));
  const series = [
    { type: "league_playoff_sf1", title: "Semifinále 1", fallback: "1. vs 4." },
    { type: "league_playoff_sf2", title: "Semifinále 2", fallback: "2. vs 3." },
    { type: "league_playoff_final", title: "Finále", fallback: "Vítězové semifinále", final: true }
  ];

  els.playoffBracket.innerHTML = series.map(item => {
    const seriesMatches = matches
      .filter(match => match.competition_type === item.type)
      .sort((first, second) => Number(first.round_number) - Number(second.round_number));
    if (!seriesMatches.length) {
      return `
        <article class="playoff-series waiting">
          <span class="playoff-stage">${item.title}</span>
          <strong>${item.fallback}</strong>
          <small>Čeká na postupující</small>
        </article>
      `;
    }

    const firstMatch = seriesMatches[0];
    const firstTeam = teamsById.get(String(firstMatch.home_team_id));
    const secondTeam = teamsById.get(String(firstMatch.away_team_id));
    const firstWins = countSeriesWins(seriesMatches, firstMatch.home_team_id);
    const secondWins = countSeriesWins(seriesMatches, firstMatch.away_team_id);
    const winnerId = firstWins >= 2
      ? firstMatch.home_team_id
      : secondWins >= 2 ? firstMatch.away_team_id : null;
    const winner = winnerId ? teamsById.get(String(winnerId)) : null;

    return `
      <article class="playoff-series ${winner ? "decided" : "active"}">
        <span class="playoff-stage">${item.title}</span>
        ${renderSeriesTeam(firstTeam, firstWins, winnerId)}
        ${renderSeriesTeam(secondTeam, secondWins, winnerId)}
        <div class="series-games">
          ${seriesMatches.map(match => renderSeriesGame(match, teamsById)).join("")}
        </div>
        <div class="series-advance ${winner ? "ready" : ""}">
          ${winner
            ? `${item.final ? "Mistr" : "Postupuje"}: <strong>${escapeHtml(winner.short_name || winner.name)}</strong>`
            : "Série probíhá"}
        </div>
      </article>
    `;
  }).join("");
}

function countSeriesWins(matches, teamId) {
  return matches.filter(match => {
    if (!isPlayedLeagueMatch(match)) return false;
    const winnerId = Number(match.home_goals) > Number(match.away_goals)
      ? match.home_team_id
      : match.away_team_id;
    return String(winnerId) === String(teamId);
  }).length;
}

function renderSeriesTeam(team, wins, winnerId) {
  if (!team) return "";
  const winner = String(team.id) === String(winnerId || "");
  return `
    <div class="series-team ${winner ? "winner" : ""}">
      <img src="${getTeamLogo(team.short_name)}" alt="" class="team-logo" onerror="this.onerror=null;this.src='images/teams/default.svg'">
      <span><strong>${escapeHtml(team.short_name || team.name)}</strong><small>${escapeHtml(team.name)}</small></span>
      <b>${wins}</b>
    </div>
  `;
}

function renderSeriesGame(match, teamsById) {
  const home = teamsById.get(String(match.home_team_id));
  const away = teamsById.get(String(match.away_team_id));
  const played = isPlayedLeagueMatch(match);
  return `
    <span class="series-game ${played ? "played" : ""}">
      ${Number(match.round_number)}. zápas ·
      ${escapeHtml(home?.short_name || "?")} ${played ? Number(match.home_goals) : "–"}
      : ${played ? Number(match.away_goals) : "–"} ${escapeHtml(away?.short_name || "?")}
    </span>
  `;
}

function renderLastFive(form) {
  const lastFive = [...form]
    .sort((first, second) =>
      first.playedAt.localeCompare(second.playedAt)
      || first.round - second.round
      || first.id.localeCompare(second.id)
    )
    .slice(-5);

  if (!lastFive.length) return '<span class="form-empty">—</span>';
  return `
    <span class="last-five" aria-label="Posledních pět zápasů: ${lastFive.map(item => item.result).join(", ")}">
      ${lastFive.map(item => `
        <span class="form-result form-${item.result.toLowerCase()}">${item.result}</span>
      `).join('<span class="form-separator">,</span>')}
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
