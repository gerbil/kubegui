async function getLatestRelease(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);

    const data = await response.json();
    const version = data.tag_name || 'N/A';

    // Update all elements with class 'version'
    const versionElements = document.querySelectorAll('.release-version');
    versionElements.forEach(el => el.textContent = version);

    // Fetch release info
    renderReleaseNotes(owner, repo)

  } catch (error) {
    console.error('Error fetching version:', error);
    const versionElements = document.querySelectorAll('.release-version');
    versionElements.forEach(el => el.textContent = 'Error');
  }
}

function renderReleaseNotes(OWNER, REPO) {
  const gridEl = document.getElementById("release-grid");
  const subEl = document.getElementById("release-sub");
  const linkEl = document.getElementById("release-link");
  const tpl = document.getElementById("release-card-tpl");

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Heuristic: pick markdown bullet lines; otherwise use non-empty lines.
  function bodyToItems(body) {
    const lines = String(body || "").split(/\r?\n/);

    const bullets = lines
      .map(l => l.trim())
      .filter(l => /^([-*]|\d+\.)\s+/.test(l))
      .map(l => l.replace(/^([-*]|\d+\.)\s+/, "").trim())
      .filter(Boolean);

    const items = bullets.length ? bullets : lines.map(l => l.trim()).filter(Boolean);

    // keep it reasonable for a grid
    return items.slice(0, 12);
  }

  // Categorize by keywords (very light). You can tailor this to your repo conventions.
  function categorize(text) {
    const t = text.toLowerCase();
    if (/(break|breaking)/.test(t)) return {
      badge: "BRK",
      badgeClass: "text-red-700",
      boxClass: "bg-red-50"
    };
    if (/(fix|bug|patch)/.test(t)) return {
      badge: "FIX",
      badgeClass: "text-amber-700",
      boxClass: "bg-amber-50"
    };
    if (/(add|new|feature)/.test(t)) return {
      badge: "NEW",
      badgeClass: "text-green-700",
      boxClass: "bg-green-50"
    };
    return {
      badge: "CHG",
      badgeClass: "text-gray-700",
      boxClass: "bg-gray-100"
    };
  }

  function splitTitleDesc(text) {
    // Split at first ":" or " - " if present, else make a short title.
    const m = text.match(/^(.{1,60}?)(?:\s*[:\-–]\s+)(.+)$/);
    if (m) return {
      title: m[1],
      desc: m[2]
    };

    const short = text.length > 60 ? text.slice(0, 60).trimEnd() + "…" : text;
    return {
      title: short,
      desc: text
    };
  }

  async function fetchLatestRelease() {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
    const res = await fetch(url, {headers: {"Accept": "application/vnd.github+json"}});

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API error ${res.status}: ${text || res.statusText}`);
    }
    return res.json();
  }

  function renderCards(release) {
    const tag = release.tag_name || "";
    const name = release.name || tag || "Latest release";
    const published = release.published_at ? new Date(release.published_at) : null;

    subEl.innerHTML = `
      <span class="font-medium text-gray-700">${escapeHtml(name)}</span>
      ${published ? `<span class="text-gray-400"> • ${escapeHtml(published.toLocaleString())}</span>` : ""}
      ${tag ? `<span class="ml-2 inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">${escapeHtml(tag)}</span>` : ""}
    `;

    if (release.html_url) {
      linkEl.href = release.html_url;
      linkEl.classList.remove("hidden");
    }

    const items = bodyToItems(release.body);
    gridEl.innerHTML = "";

    if (!items.length) {
      gridEl.innerHTML = `
        <div class="col-span-full bg-gray-50 px-8 py-10 rounded-md border border-gray-100 text-gray-500">
          No release notes available.
        </div>
      `;
      return;
    }

    for (const item of items) {
      const node = tpl.content.cloneNode(true);

      const {
        badge,
        badgeClass,
        boxClass
      } = categorize(item);
      const {
        title,
        desc
      } = splitTitleDesc(item);

      // left badge
      const badgeEl = node.querySelector("[data-badge]");
      const badgeBox = badgeEl?.closest("div");
      badgeEl.textContent = badge;
      badgeEl.classList.add(...badgeClass.split(" "));
      if (badgeBox) {
        badgeBox.classList.remove("bg-gray-100");
        badgeBox.classList.add(boxClass);
      }

      // right tag
      const tagEl = node.querySelector("[data-tag]");
      tagEl.textContent = tag || "release";
      if (!tag) tagEl.classList.add("opacity-60");

      // title/desc
      node.querySelector("[data-title]").textContent = title;
      node.querySelector("[data-desc]").textContent = desc;

      gridEl.appendChild(node);
    }
  }

  (async () => {
      try {
        const release = await fetchLatestRelease();
        renderCards(release);
      } catch (err) {
        gridEl.innerHTML = `
        <div class="col-span-full bg-red-50 px-8 py-10 rounded-md border border-red-100 text-red-700">
          ${escapeHtml(err.message)}
        </div>
      `;
      }
    }
  )();
}