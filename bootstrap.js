(async function () {
  const params = new URLSearchParams(window.location.search);
  const talk = params.get("talk");
  const dataPathFromQuery = params.get("data");

  const candidates = [];
  if (dataPathFromQuery) {
    candidates.push(dataPathFromQuery);
  }
  if (talk) {
    candidates.push(`data/talks/${encodeURIComponent(talk)}.json`);
  }
  candidates.push("data/ted-talk.json");

  async function tryLoadData(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  let loadedData = null;
  let loadedPath = "";
  for (const path of candidates) {
    try {
      loadedData = await tryLoadData(path);
      loadedPath = path;
      break;
    } catch (error) {
      continue;
    }
  }

  if (!loadedData) {
    document.body.innerHTML = "<p style='padding:16px;'>加载音频数据失败，请先运行抓取脚本。</p>";
    return;
  }

  window.TED_TALK_DATA = loadedData;
  window.TED_TALK_DATA_SOURCE = loadedPath;

  const appScript = document.createElement("script");
  appScript.src = "app.js?v=20260210-8";
  document.body.appendChild(appScript);
})();
