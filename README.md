# TED-Ed 精听练习

一个纯静态的 TED-Ed 英语精听练习网页：按句精听、全文跟读、双语对照、收藏复习。音频走 TED 官方 CDN，部署后即可在线使用，无需后端。

在线访问（GitHub Pages）：https://bevilwang.github.io/TED-Ed-Listening-Practice/

## 功能

- 播放列表首页（`index.html`，站点入口）：浏览/搜索全部可练习音频，一键进入精听
- 单句精听：显示/隐藏原文与译文、重播本句、收藏本句，「下一句」自动播放
- 全文精听：滚动双语原文列表，当前句高亮跟随
- 顶部播放条：播放/暂停、进度拖动、循环次数、倍速
- 快捷键：空格（播放/暂停）、左右方向键（切句）、上下方向键、Shift
- 自动抓取 TED 中文转录（`zh-cn`）并与英文句子按时间对齐
- 收藏复习（`favorites.html`）：按演讲分组，进入「收藏精听」只练收藏的句子
- 通过 `?talk=<slug>` 加载指定演讲的练习数据

当前内置 258 个 TED-Ed 演讲数据集。

## 收藏功能说明

收藏数据**仅保存在你当前浏览器的本地缓存（localStorage）中**：不会上传服务器，也不会跨设备或跨浏览器同步。清除浏览器缓存、更换设备或使用其他浏览器后，收藏将会丢失。每位访客的收藏都只存在各自的浏览器里。

## 本地运行

```bash
# 在项目目录启动静态服务
python -m http.server 8000
```

浏览器打开：

- `http://127.0.0.1:8000/`（播放列表首页）
- `http://127.0.0.1:8000/practice.html?talk=<slug>`（练习页）

## 部署到 GitHub Pages

1. 打开仓库 **Settings → Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录 `/ (root)`，保存
4. 约 1 分钟后即可通过上方在线地址访问

## 更新数据

抓取单个 TED 演讲：

```bash
python scripts/build_ted_talk_data.py "TED演讲页面URL"
# 生成/更新：data/ted-talk.json、data/ted-talk.js
```

批量处理 YouTube 播放列表（匹配 TED-Ed）：

```bash
python scripts/build_teded_playlist_dataset.py "https://www.youtube.com/playlist?list=..."
# 生成：data/talks/*.json、data/talks/*.js
#       data/playlist-manifest.json、data/playlist-manifest.js
```

首页 `index.html` 读取 `data/playlist-manifest.json` 展示可练习音频，并跳转到 `practice.html?talk=<slug>`。

## 项目结构

```
index.html / home.js / home.css        播放列表首页（站点入口）
practice.html / bootstrap.js / app.js  精听练习页
favorites.html / favorites.js / favorites.css  收藏复习页
styles.css                          练习页样式
data/talks/*.json                   各演讲练习数据
data/playlist-manifest.json         播放列表清单
scripts/                            数据抓取脚本
```
