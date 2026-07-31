(() => {
  const START_SEASON = 2000;
  const CURRENT_SEASON_KEY = "hockey-universe-current-season";
  const SELECTED_SEASON_KEY = "hockey-universe-selected-season";

  function readSeason(key, fallback) {
    const value = Number.parseInt(localStorage.getItem(key), 10);
    return Number.isInteger(value) && value >= START_SEASON ? value : fallback;
  }

  function getCurrentSeason() {
    return readSeason(CURRENT_SEASON_KEY, START_SEASON);
  }

  function getSelectedSeason() {
    const currentSeason = getCurrentSeason();
    return Math.min(readSeason(SELECTED_SEASON_KEY, currentSeason), currentSeason);
  }

  function setSelectedSeason(season) {
    const currentSeason = getCurrentSeason();
    const normalizedSeason = Math.max(
      START_SEASON,
      Math.min(Number.parseInt(season, 10) || currentSeason, currentSeason)
    );

    localStorage.setItem(SELECTED_SEASON_KEY, String(normalizedSeason));
    return normalizedSeason;
  }

  function getAvailableSeasons() {
    const currentSeason = getCurrentSeason();
    return Array.from(
      { length: currentSeason - START_SEASON + 1 },
      (_, index) => currentSeason - index
    );
  }

  function endCurrentSeason() {
    const endedSeason = getCurrentSeason();
    const nextSeason = endedSeason + 1;

    localStorage.setItem(CURRENT_SEASON_KEY, String(nextSeason));
    localStorage.setItem(SELECTED_SEASON_KEY, String(nextSeason));

    return { endedSeason, currentSeason: nextSeason };
  }

  function syncDocument() {
    const currentSeason = getCurrentSeason();

    document.querySelectorAll(".season-chip").forEach(chip => {
      const dot = chip.querySelector(".live-dot");
      chip.textContent = `Sezóna ${currentSeason}`;
      if (dot) chip.prepend(dot);
    });

    document.querySelectorAll("[data-current-season-template]").forEach(element => {
      element.textContent = element.dataset.currentSeasonTemplate.replace(
        "{season}",
        String(currentSeason)
      );
    });
  }

  window.HockeySeason = {
    START_SEASON,
    getCurrentSeason,
    getSelectedSeason,
    setSelectedSeason,
    getAvailableSeasons,
    endCurrentSeason,
    syncDocument
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncDocument);
  } else {
    syncDocument();
  }
})();
