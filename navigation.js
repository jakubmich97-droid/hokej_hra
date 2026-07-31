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

const TABLE_SORT_COLLATOR = new Intl.Collator("cs", {
  numeric: true,
  sensitivity: "base"
});

document.querySelectorAll("table").forEach(initializeSortableTable);

function initializeSortableTable(table) {
  const headers = [...table.querySelectorAll("thead th")];
  const body = table.tBodies[0];
  if (!headers.length || !body) return;

  const sortState = { column: -1, direction: "ascending", queued: false };
  const observer = new MutationObserver(() => {
    if (sortState.column < 0 || sortState.queued) return;
    sortState.queued = true;
    requestAnimationFrame(() => {
      sortState.queued = false;
      sortTableRows();
    });
  });
  const observeRows = () => observer.observe(body, { childList: true });

  headers.forEach((header, column) => {
    header.classList.add("sortable-column");
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-sort", "none");
    header.title = `Seřadit podle sloupce ${header.textContent.trim()}`;

    const activateSort = () => {
      const sameColumn = sortState.column === column;
      sortState.column = column;
      sortState.direction = sameColumn && sortState.direction === "ascending"
        ? "descending"
        : "ascending";

      headers.forEach((item, index) => {
        const active = index === sortState.column;
        item.classList.toggle("sort-active", active);
        item.classList.toggle(
          "sort-descending",
          active && sortState.direction === "descending"
        );
        item.setAttribute("aria-sort", active ? sortState.direction : "none");
      });

      sortTableRows();
    };

    header.addEventListener("click", activateSort);
    header.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateSort();
    });
  });

  function sortTableRows() {
    const rows = [...body.rows];
    const sortableRows = rows.filter(row =>
      row.cells.length > sortState.column
      && !row.querySelector("td[colspan]")
    );
    if (sortableRows.length < 2) return;

    const placeholderRows = rows.filter(row => !sortableRows.includes(row));
    const multiplier = sortState.direction === "ascending" ? 1 : -1;
    sortableRows.sort((first, second) => {
      const firstValue = getTableSortValue(first.cells[sortState.column]);
      const secondValue = getTableSortValue(second.cells[sortState.column]);
      const firstEmpty = !firstValue || firstValue === "—";
      const secondEmpty = !secondValue || secondValue === "—";
      if (firstEmpty !== secondEmpty) return firstEmpty ? 1 : -1;
      return compareTableValues(firstValue, secondValue) * multiplier;
    });

    observer.disconnect();
    const fragment = document.createDocumentFragment();
    sortableRows.forEach(row => fragment.appendChild(row));
    placeholderRows.forEach(row => fragment.appendChild(row));
    body.appendChild(fragment);
    observeRows();
  }

  observeRows();
}

function getTableSortValue(cell) {
  return String(cell.dataset.sortValue || cell.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function compareTableValues(first, second) {
  const firstNumber = parseTableNumber(first);
  const secondNumber = parseTableNumber(second);
  if (firstNumber !== null && secondNumber !== null) {
    return firstNumber - secondNumber;
  }

  return TABLE_SORT_COLLATOR.compare(first, second);
}

function parseTableNumber(value) {
  const normalized = value
    .replace(/^#/, "")
    .replace(/\s/g, "")
    .replace(/%$/, "")
    .replace(",", ".");
  return /^[+-]?\d+(?:\.\d+)?$/.test(normalized)
    ? Number(normalized)
    : null;
}
