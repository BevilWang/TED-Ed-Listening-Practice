(function () {
  const data = window.TED_TALK_DATA;
  if (!data || !Array.isArray(data.sentences) || data.sentences.length === 0) {
    document.body.innerHTML = "<p>未找到练习数据，请先生成 data/ted-talk.js</p>";
    return;
  }

  const allSentences = data.sentences;
  let sentences = allSentences;
  let sentenceSourceIndexes = allSentences.map((_, index) => index);
  const audio = document.getElementById("audio");
  const sidebar = document.getElementById("sidebar");
  const sentenceTimeline = document.getElementById("sentenceTimeline");
  const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
  const sentenceTab = document.getElementById("sentenceTab");
  const fullTab = document.getElementById("fullTab");
  const repeatSelect = document.getElementById("repeatSelect");
  const speedSelect = document.getElementById("speedSelect");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const progressBar = document.getElementById("progressBar");
  const timeDisplay = document.getElementById("timeDisplay");
  const showOriginalCheckbox = document.getElementById("showOriginalCheckbox");
  const showTranslationCheckbox = document.getElementById("showTranslationCheckbox");
  const prevQuickBtn = document.getElementById("prevQuickBtn");
  const nextQuickBtn = document.getElementById("nextQuickBtn");
  const showOriginalBtn = document.getElementById("showOriginalBtn");
  const showTranslationBtn = document.getElementById("showTranslationBtn");
  const prevSentenceBtn = document.getElementById("prevSentenceBtn");
  const nextSentenceBtn = document.getElementById("nextSentenceBtn");
  const cardHead = document.getElementById("cardHead");
  const sentencePosition = document.getElementById("sentencePosition");
  const favoriteBtn = document.getElementById("favoriteBtn");
  const sentenceView = document.getElementById("sentenceView");
  const fullView = document.getElementById("fullView");
  const displayOriginal = document.getElementById("displayOriginal");
  const displayTranslation = document.getElementById("displayTranslation");
  const fullTranscriptList = document.getElementById("fullTranscriptList");
  const main = document.querySelector(".main");
  const pageParams = new URLSearchParams(window.location.search);

  const favoritesOnlyMode = pageParams.get("favoritesOnly") === "1";
  let mode = "sentence";
  let draggingProgress = false;
  let sentencePlayback = null;

  const modeState = {
    sentence: {
      progress: 0,
      index: 0,
      showOriginal: false,
      showTranslation: false,
      isPlaying: false,
      repeat: repeatSelect.value,
      speed: speedSelect.value,
    },
    full: {
      progress: 0,
      index: 0,
      showOriginal: false,
      showTranslation: false,
      isPlaying: false,
      repeat: repeatSelect.value,
      speed: speedSelect.value,
    },
  };

  const FAVORITES_STORAGE_KEY = "ted_listening_favorites_v1";
  const talkMeta = {
    slug: data.meta.slug || "unknown_talk",
    title: data.meta.title || "",
    speaker: data.meta.speaker || "",
    talkUrl: data.meta.sourcePage || data.meta.talkUrl || "",
    videoUrl: data.meta.videoUrl || "",
    audioUrl: data.meta.audioUrl || "",
  };
  const favoriteIds = new Set();
  const fullLineRefs = [];

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

  function favoriteIdByIndex(index) {
    return `${talkMeta.slug}::${getSourceSentenceIndex(index)}`;
  }

  function refreshFavoriteIds() {
    favoriteIds.clear();
    loadFavorites().forEach((item) => {
      if (item && item.id) {
        favoriteIds.add(item.id);
      }
    });
  }

  function isFavorite(index) {
    return favoriteIds.has(favoriteIdByIndex(index));
  }

  function upsertFavorite(index) {
    const sentence = sentences[index];
    const sourceSentenceIndex = getSourceSentenceIndex(index);
    if (!sentence) {
      return;
    }
    const id = favoriteIdByIndex(index);
    const list = loadFavorites();
    const existingIndex = list.findIndex((item) => item && item.id === id);
    if (existingIndex >= 0) {
      list.splice(existingIndex, 1);
    } else {
      list.push({
        id,
        talkSlug: talkMeta.slug,
        talkTitle: talkMeta.title,
        talkSpeaker: talkMeta.speaker,
        talkUrl: talkMeta.talkUrl,
        videoUrl: talkMeta.videoUrl,
        audioUrl: talkMeta.audioUrl,
        sentenceIndex: sourceSentenceIndex,
        sentenceStart: sentence.start,
        sentenceEnd: sentence.end,
        sentenceText: sentence.text,
        sentenceTranslation: sentence.translation || "",
        createdAt: new Date().toISOString(),
      });
    }
    saveFavorites(list);
    refreshFavoriteIds();
  }

  function removeFavoriteByDisplayIndex(displayIndex) {
    const sourceSentenceIndex = getSourceSentenceIndex(displayIndex);
    const removeId = `${talkMeta.slug}::${sourceSentenceIndex}`;
    const list = loadFavorites().filter((item) => item.id !== removeId);
    saveFavorites(list);
    refreshFavoriteIds();

    if (!favoritesOnlyMode) {
      renderDisplay();
      return;
    }

    const pairs = buildFavoriteSentencePairsForTalk(talkMeta.slug);
    if (!pairs.length) {
      clearSentencePlayback();
      audio.pause();
      document.body.innerHTML = "<p style='padding:16px;'>该视频收藏已清空，可返回收藏页继续选择。</p>";
      return;
    }

    const currentSourceIndex = getSourceSentenceIndex(getState().index);
    sentenceSourceIndexes = pairs.map((item) => item.sourceIndex);
    sentences = pairs.map((item) => item.sentence);

    let nextDisplayIndex = getDisplaySentenceIndexBySource(currentSourceIndex);
    if (nextDisplayIndex < 0) {
      nextDisplayIndex = Math.min(displayIndex, sentences.length - 1);
    }

    modeState.sentence.index = Math.max(0, nextDisplayIndex);
    modeState.full.index = modeState.sentence.index;
    modeState.sentence.showOriginal = false;
    modeState.sentence.showTranslation = false;

    const nextSentence = sentences[modeState.sentence.index];
    clearSentencePlayback();
    audio.pause();
    audio.currentTime = nextSentence.start;
    modeState.sentence.progress = audio.currentTime;
    modeState.full.progress = audio.currentTime;

    buildFullTranscriptList();
    renderTimeline();
    renderDisplay();
    scrollCurrentSentenceIntoView();
    updateTimeDisplay();
    updateProgressBar();
  }

  function getState(modeName = mode) {
    return modeState[modeName];
  }

  function getSourceSentenceIndex(displayIndex) {
    const safeDisplayIndex = clampIndex(displayIndex);
    const sourceIndex = sentenceSourceIndexes[safeDisplayIndex];
    if (Number.isInteger(sourceIndex)) {
      return sourceIndex;
    }
    return safeDisplayIndex;
  }

  function getDisplaySentenceIndexBySource(sourceIndex) {
    return sentenceSourceIndexes.indexOf(sourceIndex);
  }

  function getFavoriteSourceIndexesForTalk(talkSlug) {
    const sourceIndexes = loadFavorites()
      .filter((item) => item.talkSlug === talkSlug && Number.isInteger(item.sentenceIndex))
      .map((item) => item.sentenceIndex);
    return Array.from(new Set(sourceIndexes)).sort((left, right) => left - right);
  }

  function buildFavoriteSentencePairsForTalk(talkSlug) {
    const sourceIndexes = getFavoriteSourceIndexesForTalk(talkSlug);
    return sourceIndexes
      .map((sourceIndex) => ({ sourceIndex, sentence: allSentences[sourceIndex] }))
      .filter((item) => item.sentence);
  }

  function applyFavoritesOnlyFilter() {
    if (!favoritesOnlyMode) {
      return true;
    }
    const pairs = buildFavoriteSentencePairsForTalk(talkMeta.slug);
    if (!pairs.length) {
      document.body.innerHTML = "<p style='padding:16px;'>该视频暂无收藏句子，请先收藏后再进入此入口。</p>";
      return false;
    }

    sentenceSourceIndexes = pairs.map((item) => item.sourceIndex);
    sentences = pairs.map((item) => item.sentence);
    mode = "sentence";
    return true;
  }

  function totalDuration() {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }
    return data.meta.duration || sentences[sentences.length - 1].end;
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
    const ss = String(safeSeconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function clampIndex(index) {
    return Math.min(Math.max(index, 0), sentences.length - 1);
  }

  function getSentenceIndexFromQuery() {
    const value = pageParams.get("sentence");
    if (value === null) {
      return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      return null;
    }
    return parsed;
  }

  function resolveInitialSentenceIndex() {
    const querySentenceIndex = getSentenceIndexFromQuery();
    if (querySentenceIndex === null) {
      return 0;
    }

    if (favoritesOnlyMode) {
      const displayIndex = getDisplaySentenceIndexBySource(querySentenceIndex);
      return displayIndex >= 0 ? displayIndex : 0;
    }

    return clampIndex(querySentenceIndex);
  }

  function currentSentence(modeName = mode) {
    return sentences[getState(modeName).index];
  }

  function sentenceLength(index) {
    return Math.max(0, sentences[index].end - sentences[index].start);
  }

  function findSentenceByTime(time) {
    for (let index = 0; index < sentences.length; index += 1) {
      const item = sentences[index];
      if (time >= item.start && time <= item.end) {
        return index;
      }
    }
    if (time > sentences[sentences.length - 1].end) {
      return sentences.length - 1;
    }
    return -1;
  }

  function getSelectedSpeed() {
    const speed = Number.parseFloat(speedSelect.value);
    if (!Number.isFinite(speed) || speed <= 0) {
      return 1;
    }
    return speed;
  }

  function applyPlaybackRate() {
    const speed = getSelectedSpeed();
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
  }

  function updatePlayButton() {
    playPauseBtn.textContent = audio.paused ? "▶" : "❚❚";
  }

  function updateTimeDisplay() {
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(totalDuration())}`;
  }

  function updateProgressBar() {
    if (draggingProgress) {
      return;
    }
    const duration = totalDuration();
    const ratio = duration > 0 ? audio.currentTime / duration : 0;
    progressBar.value = String(Math.max(0, Math.min(1000, Math.round(ratio * 1000))));
  }

  function renderTimeline() {
    const state = getState();
    sentenceTimeline.innerHTML = "";
    sentences.forEach((sentence, index) => {
      const item = document.createElement("div");
      item.className = "sentence-item";
      item.dataset.index = String(index);
      if (index === state.index) {
        item.classList.add("active");
      }

      const dot = document.createElement("span");
      dot.className = "sentence-dot";
      const content = document.createElement("span");
      content.className = "sentence-content";
      const label = document.createElement("span");
      label.className = "sentence-label";
      label.textContent = `第${getSourceSentenceIndex(index) + 1}句`;
      const duration = document.createElement("span");
      duration.className = "sentence-duration";
      duration.textContent = `— ${sentenceLength(index).toFixed(2)}s`;
      content.append(label, duration);
      item.append(dot, content);

      if (favoritesOnlyMode) {
        const actions = document.createElement("span");
        actions.className = "sentence-actions";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "sentence-unfavorite-btn";
        remove.textContent = "取消收藏";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          removeFavoriteByDisplayIndex(index);
        });
        actions.appendChild(remove);
        item.appendChild(actions);
      }

      item.addEventListener("click", () => {
        setCurrentIndex(index, true, true);
      });
      sentenceTimeline.appendChild(item);
    });
  }

  function buildFullTranscriptList() {
    fullLineRefs.length = 0;
    fullTranscriptList.innerHTML = "";
    sentences.forEach((sentence, index) => {
      const line = document.createElement("div");
      line.className = "full-line";
      line.dataset.index = String(index);

      const firstRow = document.createElement("div");
      firstRow.className = "full-line-en-row";
      const number = document.createElement("span");
      number.className = "full-line-no";
      number.textContent = `${index + 1}:`;
      const english = document.createElement("span");
      english.className = "full-line-en";
      english.textContent = sentence.text;
      firstRow.append(number, english);

      const chinese = document.createElement("p");
      chinese.className = "full-line-zh";
      chinese.textContent = sentence.translation || "";

      line.append(firstRow, chinese);
      line.addEventListener("click", () => {
        setCurrentIndex(index, false, true);
      });

      fullTranscriptList.appendChild(line);
      fullLineRefs.push({ line, english, chinese });
    });
  }

  function renderFullTranscriptState(scrollCurrent) {
    const state = getState("full");
    const showAny = state.showOriginal || state.showTranslation;
    fullTranscriptList.classList.toggle("hidden", !showAny);

    fullLineRefs.forEach((refs, index) => {
      refs.line.classList.toggle("active", index === state.index);
      refs.english.classList.toggle("hidden", !state.showOriginal);
      refs.chinese.classList.toggle("hidden", !state.showTranslation || !sentences[index].translation);
    });

    if (scrollCurrent) {
      const activeLine = fullTranscriptList.querySelector(`.full-line[data-index="${state.index}"]`);
      activeLine?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function renderDisplay() {
    const state = getState();
    const sentence = sentences[state.index];
    sentencePosition.textContent = `${state.index + 1} / ${sentences.length}`;
    displayOriginal.textContent = sentence.text;
    displayTranslation.textContent = sentence.translation || "";

    const sentenceMode = mode === "sentence";
    const showOriginal = state.showOriginal;
    const showTranslation = state.showTranslation;
    sentenceView.classList.toggle("hidden", !sentenceMode);
    fullView.classList.toggle("hidden", sentenceMode);

    displayOriginal.classList.toggle("hidden", !sentenceMode || !showOriginal);
    displayTranslation.classList.toggle(
      "hidden",
      !sentenceMode || !showTranslation || !sentence.translation
    );

    showOriginalCheckbox.checked = showOriginal;
    showTranslationCheckbox.checked = showTranslation;
    favoriteBtn.textContent = isFavorite(state.index) ? "★ 已收藏" : "☆ 收藏本句";
    if (!sentenceMode) {
      renderFullTranscriptState(false);
    }
  }

  function renderMode() {
    const sentenceMode = mode === "sentence";
    sentenceTab.classList.toggle("active", sentenceMode);
    fullTab.classList.toggle("active", !sentenceMode);
    fullTab.classList.toggle("hidden", favoritesOnlyMode);
    cardHead.classList.toggle("hidden", !sentenceMode);
    showOriginalBtn.classList.toggle("hidden", !sentenceMode);
    showTranslationBtn.classList.toggle("hidden", !sentenceMode);
    main.classList.toggle("full-mode", !sentenceMode);
    if (!sentenceMode) {
      renderFullTranscriptState(true);
    }
  }

  function scrollCurrentSentenceIntoView() {
    const index = getState().index;
    const item = sentenceTimeline.querySelector(`.sentence-item[data-index="${index}"]`);
    if (item) {
      item.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function clearSentencePlayback() {
    sentencePlayback = null;
  }

  function syncModeStateFromControls(modeName = mode) {
    const state = getState(modeName);
    state.repeat = repeatSelect.value;
    state.speed = speedSelect.value;
  }

  function restoreControlsFromState(modeName = mode) {
    const state = getState(modeName);
    if (state.repeat) {
      repeatSelect.value = state.repeat;
    }
    if (state.speed) {
      speedSelect.value = state.speed;
    }
    applyPlaybackRate();
  }

  function saveCurrentModeState() {
    const state = getState();
    state.progress = audio.currentTime;
    state.isPlaying = !audio.paused;
    syncModeStateFromControls(mode);
  }

  function restoreMediaStateForMode(modeName) {
    const state = getState(modeName);
    restoreControlsFromState(modeName);
    const duration = totalDuration();
    const targetTime = Number(state.progress ?? 0);
    audio.currentTime = Math.max(0, Math.min(duration, Number.isFinite(targetTime) ? targetTime : 0));
    const active = findSentenceByTime(audio.currentTime);
    if (active >= 0) {
      state.index = active;
    }
  }

  function playSentence(index, repeat, forceStart) {
    const state = getState("sentence");
    state.index = clampIndex(index);
    const sentence = currentSentence("sentence");
    const repeatCount = Math.max(1, Number(repeat) || 1);
    sentencePlayback = {
      index: state.index,
      start: sentence.start,
      end: sentence.end,
      remaining: repeatCount,
    };
    if (forceStart || audio.currentTime < sentence.start || audio.currentTime > sentence.end) {
      audio.currentTime = sentence.start;
    }
    state.progress = audio.currentTime;
    renderTimeline();
    renderDisplay();
    scrollCurrentSentenceIntoView();
    applyPlaybackRate();
    audio.play();
  }

  function playFromCurrent(forceStart) {
    const state = getState();
    if (mode === "sentence") {
      playSentence(state.index, state.repeat, forceStart);
      return;
    }

    clearSentencePlayback();
    if (forceStart) {
      audio.currentTime = currentSentence("full").start;
    }
    state.progress = audio.currentTime;
    renderTimeline();
    renderDisplay();
    scrollCurrentSentenceIntoView();
    applyPlaybackRate();
    audio.play();
  }

  function setCurrentIndex(index, autoPlay, jumpToSentenceStart) {
    const state = getState();
    const nextIndex = clampIndex(index);
    const changed = nextIndex !== state.index;
    state.index = nextIndex;
    if (mode === "sentence" && changed) {
      state.showOriginal = false;
      state.showTranslation = false;
    }
    if (jumpToSentenceStart) {
      audio.currentTime = currentSentence().start;
      state.progress = audio.currentTime;
    }
    renderTimeline();
    renderDisplay();
    if (mode === "full") {
      renderFullTranscriptState(true);
    }
    scrollCurrentSentenceIntoView();
    if (autoPlay) {
      playFromCurrent(true);
    } else {
      clearSentencePlayback();
    }
  }

  function nextSentence(autoPlay) {
    const state = getState();
    const shouldAutoPlay = mode === "sentence" ? autoPlay : false;
    setCurrentIndex(state.index + 1, shouldAutoPlay, true);
  }

  function prevSentence(autoPlay) {
    const state = getState();
    const shouldAutoPlay = mode === "sentence" ? autoPlay || !audio.paused : autoPlay;
    setCurrentIndex(state.index - 1, shouldAutoPlay, true);
  }

  function togglePlayPause() {
    const state = getState();
    if (!audio.paused) {
      audio.pause();
      state.isPlaying = false;
      return;
    }

    if (mode === "sentence") {
      const sentence = currentSentence("sentence");
      const inSentenceRange =
        audio.currentTime >= sentence.start && audio.currentTime < sentence.end - 0.05;
      const canResumeCurrent =
        sentencePlayback && sentencePlayback.index === state.index && inSentenceRange;

      if (canResumeCurrent) {
        applyPlaybackRate();
        audio.play();
        return;
      }

      playSentence(state.index, state.repeat, true);
      return;
    }

    applyPlaybackRate();
    audio.play();
  }

  function seekByProgress() {
    const state = getState();
    const duration = totalDuration();
    const ratio = Number(progressBar.value) / 1000;
    audio.currentTime = Math.max(0, Math.min(duration, ratio * duration));
    state.progress = audio.currentTime;

    const active = findSentenceByTime(audio.currentTime);
    if (active >= 0) {
      state.index = active;
      renderTimeline();
      renderDisplay();
      if (mode === "full") {
        renderFullTranscriptState(true);
      }
      scrollCurrentSentenceIntoView();
    } else {
      clearSentencePlayback();
    }
    updateTimeDisplay();
    updateProgressBar();
  }

  function switchMode(targetMode) {
    if (favoritesOnlyMode && targetMode !== "sentence") {
      return;
    }
    if (mode === targetMode) {
      return;
    }

    saveCurrentModeState();
    clearSentencePlayback();
    mode = targetMode;
    restoreMediaStateForMode(targetMode);

    renderMode();
    renderTimeline();
    renderDisplay();
    scrollCurrentSentenceIntoView();
    updateTimeDisplay();
    updateProgressBar();

    const state = getState();
    if (state.isPlaying) {
      playFromCurrent(false);
    } else {
      audio.pause();
    }
  }

  function handleKeydown(event) {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    const typing = tag === "input" || tag === "textarea" || tag === "select";

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayPause();
      return;
    }
    if (typing) {
      return;
    }

    const state = getState();
    if (event.code === "ArrowLeft") {
      prevSentence(false);
    } else if (event.code === "ArrowRight") {
      nextSentence(true);
    } else if (event.code === "ArrowUp") {
      state.showOriginal = !state.showOriginal;
      renderDisplay();
    } else if (event.code === "ArrowDown") {
      state.showTranslation = !state.showTranslation;
      renderDisplay();
    } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      playFromCurrent(true);
    }
  }

  function bindEvents() {
    toggleSidebarBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });

    sentenceTab.addEventListener("click", () => {
      switchMode("sentence");
    });

    fullTab.addEventListener("click", () => {
      switchMode("full");
    });

    repeatSelect.addEventListener("change", () => {
      const state = getState();
      state.repeat = repeatSelect.value;
      if (mode === "sentence" && !audio.paused) {
        playFromCurrent(true);
      }
      repeatSelect.blur();
    });

    speedSelect.addEventListener("change", () => {
      const state = getState();
      state.speed = speedSelect.value;
      applyPlaybackRate();
      speedSelect.blur();
    });

    playPauseBtn.addEventListener("click", togglePlayPause);
    prevQuickBtn.addEventListener("click", () => prevSentence(false));
    nextQuickBtn.addEventListener("click", () => nextSentence(true));
    prevSentenceBtn.addEventListener("click", () => prevSentence(false));
    nextSentenceBtn.addEventListener("click", () => nextSentence(true));

    showOriginalBtn.addEventListener("click", () => {
      const state = getState();
      state.showOriginal = !state.showOriginal;
      renderDisplay();
    });

    showTranslationBtn.addEventListener("click", () => {
      const state = getState();
      state.showTranslation = !state.showTranslation;
      renderDisplay();
    });

    showOriginalCheckbox.addEventListener("change", () => {
      const state = getState();
      state.showOriginal = showOriginalCheckbox.checked;
      renderDisplay();
    });

    showTranslationCheckbox.addEventListener("change", () => {
      const state = getState();
      state.showTranslation = showTranslationCheckbox.checked;
      renderDisplay();
    });

    favoriteBtn.addEventListener("click", () => {
      const state = getState();
      upsertFavorite(state.index);
      renderDisplay();
    });

    progressBar.addEventListener("pointerdown", () => {
      draggingProgress = true;
    });
    progressBar.addEventListener("pointerup", () => {
      draggingProgress = false;
      seekByProgress();
    });
    progressBar.addEventListener("input", seekByProgress);
    progressBar.addEventListener("change", seekByProgress);

    audio.addEventListener("play", () => {
      getState().isPlaying = true;
      updatePlayButton();
    });

    audio.addEventListener("pause", () => {
      getState().isPlaying = false;
      updatePlayButton();
    });

    audio.addEventListener("ended", () => {
      clearSentencePlayback();
      getState().isPlaying = false;
      updatePlayButton();
    });

    audio.addEventListener("timeupdate", () => {
      const state = getState();
      state.progress = audio.currentTime;
      updateTimeDisplay();
      updateProgressBar();

      if (mode === "sentence" && sentencePlayback) {
        if (audio.currentTime >= sentencePlayback.end) {
          if (sentencePlayback.remaining > 1) {
            sentencePlayback.remaining -= 1;
            audio.currentTime = sentencePlayback.start;
            state.progress = audio.currentTime;
            audio.play();
          } else {
            audio.currentTime = Math.max(sentencePlayback.start, sentencePlayback.end - 0.06);
            state.progress = audio.currentTime;
            clearSentencePlayback();
            audio.pause();
          }
        }
        return;
      }

      const active = findSentenceByTime(audio.currentTime);
      if (active >= 0 && active !== state.index) {
        state.index = active;
        renderTimeline();
        renderDisplay();
        if (mode === "full") {
          renderFullTranscriptState(true);
        }
      }
    });

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("storage", (event) => {
      if (event.key === FAVORITES_STORAGE_KEY) {
        refreshFavoriteIds();
        renderDisplay();
      }
    });
  }

  function init() {
    if (!applyFavoritesOnlyFilter()) {
      return;
    }
    audio.src = data.meta.videoUrl || data.meta.audioUrl;
    const initialSentenceIndex = resolveInitialSentenceIndex();
    modeState.sentence.index = initialSentenceIndex;
    modeState.sentence.progress = sentences[initialSentenceIndex].start;
    audio.currentTime = sentences[initialSentenceIndex].start;
    modeState.full.index = initialSentenceIndex;
    modeState.full.progress = sentences[initialSentenceIndex].start;
    refreshFavoriteIds();
    restoreControlsFromState(mode);
    buildFullTranscriptList();
    renderMode();
    renderTimeline();
    renderDisplay();
    updatePlayButton();
    updateTimeDisplay();
    updateProgressBar();
    bindEvents();
  }

  init();
})();

