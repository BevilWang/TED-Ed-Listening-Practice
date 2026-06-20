(async function () {
  const playlistMeta = document.getElementById("playlistMeta");
  const talkList = document.getElementById("talkList");
  const searchInput = document.getElementById("searchInput");

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(seconds || 0));
    const minute = String(Math.floor(value / 60)).padStart(2, "0");
    const second = String(value % 60).padStart(2, "0");
    return `${minute}:${second}`;
  }

  function renderTalkItems(items) {
    talkList.innerHTML = "";
    if (!items.length) {
      talkList.innerHTML = "<p>没有可显示的音频。</p>";
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "talk-item";

      const title = document.createElement("p");
      title.className = "talk-title";
      title.textContent = item.title || "";

      const meta = document.createElement("p");
      meta.className = "talk-meta";
      meta.textContent = `${item.speaker || ""} · ${formatTime(item.duration)}`;

      const actions = document.createElement("div");
      actions.className = "talk-actions";

      const start = document.createElement("a");
      start.className = "start-btn";
      start.href = `practice.html?talk=${encodeURIComponent(item.slug)}`;
      start.textContent = "开始练习";

      const tedLink = document.createElement("a");
      tedLink.className = "ted-link";
      tedLink.href = item.talkUrl;
      tedLink.target = "_blank";
      tedLink.rel = "noreferrer";
      tedLink.textContent = "TED 页面";

      actions.append(start, tedLink);
      card.append(title, meta, actions);
      talkList.appendChild(card);
    });
  }

  let manifest;
  try {
    const response = await fetch("data/playlist-manifest.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    manifest = await response.json();
  } catch (error) {
    playlistMeta.textContent = "未找到播放列表清单，请先运行批量抓取脚本。";
    talkList.innerHTML = "<p>示例：python scripts/build_teded_playlist_dataset.py \"播放列表URL\"</p>";
    return;
  }

  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const playlist = manifest.playlist || {};
  playlistMeta.textContent = `${playlist.title || "未知列表"} · 共 ${items.length} 个音频`;

  renderTalkItems(items);

  searchInput.addEventListener("input", () => {
    const keyword = searchInput.value.trim().toLowerCase();
    if (!keyword) {
      renderTalkItems(items);
      return;
    }
    const filtered = items.filter((item) => {
      const text = `${item.title || ""} ${item.speaker || ""} ${item.slug || ""}`.toLowerCase();
      return text.includes(keyword);
    });
    renderTalkItems(filtered);
  });
})();
