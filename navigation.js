const GAME_NAV_ITEMS = [
  { key: "dashboard", href: "index.html", icon: "▦", label: "Dashboard" },
  { key: "players", href: "players.html", icon: "●", label: "Hráči" },
  { key: "goalies", href: "goalies.html", icon: "◉", label: "Brankáři" },
  { key: "teams", href: "teams.html", icon: "◆", label: "Týmy" },
  { key: "league", href: "league.html", icon: "L", label: "Liga" },
  { key: "matches", href: "matches.html", icon: "VS", label: "Zápasy" },
  { key: "rep-sen", href: "rep-sen.html", icon: "S", label: "Rep Sen" },
  { key: "rep-u21", href: "rep-u21.html", icon: "21", label: "Rep U21" },
  { key: "rep-u18", href: "rep-u18.html", icon: "18", label: "Rep U18" }
];

document.querySelectorAll(".game-nav").forEach(nav => {
  const activeKey = nav.dataset.active;

  nav.innerHTML = GAME_NAV_ITEMS.map(item => `
    <a href="${item.href}" class="${item.key === activeKey ? "active" : ""}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${item.label}</span>
    </a>
  `).join("");

  requestAnimationFrame(() => {
    nav.querySelector(".active")?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center"
    });
  });
});
