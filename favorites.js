(function () {
  const FAVORITES_STORAGE_KEY = "ted_listening_favorites_v1";
  const favoriteMeta = document.getElementById("favoriteMeta");
  const favoriteList = document.getElementById("favoriteList");

  function normalizeFavoriteItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const talkSlug = String(item.talkSlug || "").trim();
    const sentenceIndex = Number.parseInt(String(item.sentenceIndex), 10);
    if (!talkSlug || !Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
      return null;
    }
    const id = item.id ? String(item.id) : `${talkSlug}::${sentenceIndex}`;
    return {
      id,
      talkSlug,
      talkTitle: String(item.talkTitle || ""),
      talkSpeaker: String(item.talkSpeaker || ""),
      talkUrl: String(item.talkUrl || ""),
      videoUrl: String(item.videoUrl || ""),
      audioUrl: String(item.audioUrl || ""),
      sentenceIndex,
      sentenceStart: Number.isFinite(item.sentenceStart) ? Number(item.sentenceStart) : 0,
      sentenceEnd: Number.isFinite(item.sentenceEnd) ? Number(item.sentenceEnd) : 0,
      sentenceText: String(item.sentenceText || ""),
      sentenceTranslation: String(item.sentenceTranslation || ""),
      createdAt: String(item.createdAt || new Date().toISOString()),
    };
  }

  function normalizeFavorites(list) {
    const mapped = new Map();
    let changed = false;
    list.forEach((item) => {
      const normalized = normalizeFavoriteItem(item);
      if (!normalized) {
        changed = true;
        return;
      }
      if (mapped.has(normalized.id)) {
        changed = true;
      }
      mapped.set(normalized.id, normalized);
    });
    const normalizedList = Array.from(mapped.values());
    if (!changed && normalizedList.length !== list.length) {
      changed = true;
    }
    return { list: normalizedList, changed };
  }

  function saveFavorites(list) {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(list));
    } catch (error) {
      // ignore storage write failures
    }
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      const sourceList = Array.isArray(parsed) ? parsed : [];
      const { list, changed } = normalizeFavorites(sourceList);
      if (changed) {
        saveFavorites(list);
      }
      return list;
    } catch (error) {
      return [];
    }
  }

  function groupByTalk(favorites) {
    const grouped = new Map();
    favorites.forEach((item) => {
      if (!grouped.has(item.talkSlug)) {
        grouped.set(item.talkSlug, {
          talkSlug: item.talkSlug,
          talkTitle: item.talkTitle || item.talkSlug,
          talkSpeaker: item.talkSpeaker || "",
          count: 0,
        });
      }
      grouped.get(item.talkSlug).count += 1;
    });
    return Array.from(grouped.values()).sort((left, right) =>
      left.talkTitle.localeCompare(right.talkTitle, "zh-CN")
    );
  }

  function buildPracticeUrl(talkSlug) {
    return `index.html?talk=${encodeURIComponent(talkSlug)}&favoritesOnly=1`;
  }

  function render() {
    const favorites = loadFavorites();
    favoriteList.innerHTML = "";

    if (!favorites.length) {
      favoriteMeta.textContent = "共 0 个视频，收藏 0 句";
      favoriteList.innerHTML = "<p>还没有收藏句子，去练习页点击“收藏本句”吧。</p>";
      return;
    }

    const groups = groupByTalk(favorites);
    favoriteMeta.textContent = `共 ${groups.length} 个视频，收藏 ${favorites.length} 句`;

    groups.forEach((group) => {
      const card = document.createElement("article");
      card.className = "talk-item favorite-item";

      const title = document.createElement("p");
      title.className = "talk-title";
      title.textContent = group.talkTitle;

      const meta = document.createElement("p");
      meta.className = "talk-meta";
      meta.textContent = `${group.talkSpeaker || "未知讲者"} · 收藏 ${group.count} 句`;

      const actions = document.createElement("div");
      actions.className = "talk-actions";

      const start = document.createElement("a");
      start.className = "start-btn";
      start.href = buildPracticeUrl(group.talkSlug);
      start.textContent = "进入收藏精听";

      actions.append(start);
      card.append(title, meta, actions);
      favoriteList.appendChild(card);
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === FAVORITES_STORAGE_KEY) {
      render();
    }
  });

  render();
})();
