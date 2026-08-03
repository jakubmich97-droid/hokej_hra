(() => {
  const STORAGE_KEY = "hockey_league_settings_v1";
  const DEFAULTS = { teamCount: 6, playoffTeamCount: 4 };
  const MIN_TEAMS = 2;
  const MAX_TEAMS = 32;

  function get() {
    try {
      return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(values) {
    const settings = normalize(values);
    const error = validate(settings);
    if (error) throw new Error(error);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return settings;
  }

  function normalize(values = {}) {
    return {
      teamCount: toInteger(values.teamCount, DEFAULTS.teamCount),
      playoffTeamCount: toInteger(values.playoffTeamCount, DEFAULTS.playoffTeamCount)
    };
  }

  function validate(settings) {
    if (settings.teamCount < MIN_TEAMS || settings.teamCount > MAX_TEAMS) {
      return `Počet týmů v lize musí být ${MIN_TEAMS} až ${MAX_TEAMS}.`;
    }
    if (settings.playoffTeamCount < 2 || settings.playoffTeamCount > settings.teamCount) {
      return "Počet týmů v play-off musí být alespoň 2 a nesmí překročit počet týmů v lize.";
    }
    if (!isPowerOfTwo(settings.playoffTeamCount)) {
      return "Pro čistý vyřazovací pavouk zadej 2, 4, 8, 16 nebo 32 týmů.";
    }
    return "";
  }

  function expectedMatches(teamCount) {
    return Number(teamCount) * (Number(teamCount) - 1);
  }

  function roundCount(teamCount) {
    const count = Number(teamCount);
    return count % 2 === 0 ? (count - 1) * 2 : count * 2;
  }

  function isPowerOfTwo(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && (number & (number - 1)) === 0;
  }

  function toInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  }

  window.HockeyLeagueSettings = {
    get,
    save,
    validate,
    expectedMatches,
    roundCount,
    isPowerOfTwo,
    limits: { minTeams: MIN_TEAMS, maxTeams: MAX_TEAMS }
  };
})();
