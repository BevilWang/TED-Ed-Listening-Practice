import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from build_ted_talk_data import build_talk_dataset, extract_next_data, fetch_html
except ModuleNotFoundError:
    from scripts.build_ted_talk_data import build_talk_dataset, extract_next_data, fetch_html


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("playlist_url")
    parser.add_argument("--output-dir", default="data/talks")
    parser.add_argument("--manifest", default="data/playlist-manifest.json")
    parser.add_argument("--manifest-js", default="data/playlist-manifest.js")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.1)
    parser.add_argument("--start-index", type=int, default=1)
    return parser.parse_args()


def normalize_title(raw_title: str) -> str:
    return re.sub(r"\s+", " ", raw_title).strip()


def decode_json_escaped_text(raw_text: str) -> str:
    try:
        return json.loads(f'"{raw_text}"')
    except Exception:
        return raw_text


def extract_playlist_title(html: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html, re.S)
    if not match:
        return "TED-Ed Playlist"
    title = match.group(1).replace("- YouTube", "").strip()
    return title or "TED-Ed Playlist"


def extract_initial_data(html: str) -> dict:
    match = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not match:
        raise RuntimeError("Cannot parse ytInitialData from playlist page.")
    return json.loads(match.group(1))


def extract_innertube_api_key(html: str) -> str:
    match = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
    if not match:
        raise RuntimeError("Cannot parse INNERTUBE_API_KEY from playlist page.")
    return match.group(1)


def extract_innertube_context(html: str) -> dict:
    match = re.search(
        r'"INNERTUBE_CONTEXT":(\{.*?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"',
        html,
        re.S,
    )
    if not match:
        raise RuntimeError("Cannot parse INNERTUBE_CONTEXT from playlist page.")
    return json.loads(match.group(1))


def collect_playlist_renderers(payload: object, output: list) -> None:
    if isinstance(payload, dict):
        renderer = payload.get("playlistVideoRenderer")
        if isinstance(renderer, dict):
            output.append(renderer)
        for value in payload.values():
            collect_playlist_renderers(value, output)
    elif isinstance(payload, list):
        for item in payload:
            collect_playlist_renderers(item, output)


def collect_continuation_tokens(payload: object, output: list) -> None:
    if isinstance(payload, dict):
        continuation = payload.get("continuationCommand")
        if isinstance(continuation, dict) and continuation.get("token"):
            output.append(continuation["token"])
        for value in payload.values():
            collect_continuation_tokens(value, output)
    elif isinstance(payload, list):
        for item in payload:
            collect_continuation_tokens(item, output)


def extract_title_from_renderer(renderer: dict) -> str:
    title_node = renderer.get("title")
    if isinstance(title_node, dict):
        runs = title_node.get("runs")
        if isinstance(runs, list) and runs:
            text = runs[0].get("text", "")
            if text:
                return normalize_title(text)
        simple_text = title_node.get("simpleText")
        if isinstance(simple_text, str) and simple_text.strip():
            return normalize_title(simple_text)
    return normalize_title(renderer.get("videoId", ""))


def extract_renderer_position(renderer: dict) -> int | None:
    index_node = renderer.get("index")
    if isinstance(index_node, dict):
        simple_text = index_node.get("simpleText")
        if isinstance(simple_text, str) and simple_text.isdigit():
            return int(simple_text)
        runs = index_node.get("runs")
        if isinstance(runs, list) and runs:
            text = str(runs[0].get("text", "")).strip()
            if text.isdigit():
                return int(text)
    return None


def append_videos_from_renderers(renderers: list, videos: list, seen_entries: set) -> None:
    for renderer in renderers:
        video_id = renderer.get("videoId")
        if not isinstance(video_id, str) or not video_id:
            continue
        position = extract_renderer_position(renderer)
        entry_key = (video_id, position)
        if entry_key in seen_entries:
            continue
        seen_entries.add(entry_key)
        videos.append(
            {
                "youtubeId": video_id,
                "youtubeTitle": extract_title_from_renderer(renderer),
                "playlistPosition": position,
            }
        )


def fetch_continuation_page(api_key: str, context: dict, token: str) -> dict:
    request = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/browse?key=" + api_key,
        data=json.dumps({"context": context, "continuation": token}).encode("utf-8"),
        headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def extract_playlist_videos(html: str) -> list:
    videos = []
    seen_entries = set()
    initial_data = extract_initial_data(html)
    api_key = extract_innertube_api_key(html)
    context = extract_innertube_context(html)

    initial_renderers = []
    collect_playlist_renderers(initial_data, initial_renderers)
    append_videos_from_renderers(initial_renderers, videos, seen_entries)

    continuation_tokens = []
    collect_continuation_tokens(initial_data, continuation_tokens)
    queue = []
    visited_tokens = set()
    for token in continuation_tokens:
        if token not in visited_tokens:
            queue.append(token)

    while queue:
        token = queue.pop(0)
        if token in visited_tokens:
            continue
        visited_tokens.add(token)
        try:
            page = fetch_continuation_page(api_key, context, token)
        except Exception:
            continue

        page_renderers = []
        collect_playlist_renderers(page, page_renderers)
        append_videos_from_renderers(page_renderers, videos, seen_entries)

        next_tokens = []
        collect_continuation_tokens(page, next_tokens)
        for next_token in next_tokens:
            if next_token not in visited_tokens:
                queue.append(next_token)

    return videos


def build_search_queries(video_title: str, video_id: str) -> list:
    queries = []
    if video_title:
        queries.append(video_title)
    if " - " in video_title:
        queries.append(video_title.split(" - ")[0].strip())
    if ":" in video_title:
        queries.append(video_title.split(":")[0].strip())
    queries.append(video_id)
    ordered = []
    for item in queries:
        cleaned = normalize_title(item)
        if cleaned and cleaned not in ordered:
            ordered.append(cleaned)
    return ordered


def extract_talk_links(search_html: str) -> list:
    links = re.findall(r'href="(/talks/[a-z0-9_?=&%\-]+)"', search_html)
    output = []
    for link in links:
        clean_link = link.split("?")[0]
        if clean_link not in output:
            output.append(clean_link)
    return output


def get_talk_external_code(talk_url: str, cache: dict) -> str | None:
    if talk_url in cache:
        return cache[talk_url]
    try:
        html = fetch_html(talk_url)
        next_data = extract_next_data(html)
        player_data_raw = next_data["props"]["pageProps"]["videoData"]["playerData"]
        player_data = json.loads(player_data_raw)
        external_code = player_data.get("external", {}).get("code")
    except Exception:
        external_code = None
    cache[talk_url] = external_code
    return external_code


def match_ted_talk(video_id: str, video_title: str, talk_code_cache: dict) -> str | None:
    queries = build_search_queries(video_title, video_id)
    checked_urls = set()
    for query in queries:
        search_url = "https://www.ted.com/search?q=" + urllib.parse.quote(query)
        try:
            search_html = fetch_html(search_url)
        except Exception:
            continue
        candidate_links = extract_talk_links(search_html)
        for link in candidate_links[:8]:
            talk_url = "https://www.ted.com" + link
            if talk_url in checked_urls:
                continue
            checked_urls.add(talk_url)
            if get_talk_external_code(talk_url, talk_code_cache) == video_id:
                return talk_url
    return None


def write_json(path: str, payload: dict) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_js_manifest(path: str, payload: dict) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "window.TED_PLAYLIST_MANIFEST = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def safe_print(message: str) -> None:
    try:
        print(message)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((message + "\n").encode("utf-8", errors="replace"))
        sys.stdout.flush()


def build_manifest_entry(
    dataset: dict,
    youtube_id: str,
    youtube_title: str,
    playlist_position: int | None,
    json_path: str,
) -> dict:
    meta = dataset["meta"]
    return {
        "slug": meta["slug"],
        "title": meta["title"],
        "speaker": meta["speaker"],
        "duration": meta["duration"],
        "talkUrl": meta["sourcePage"],
        "audioUrl": meta["audioUrl"],
        "youtubeId": youtube_id,
        "youtubeTitle": youtube_title,
        "playlistPosition": playlist_position,
        "dataJson": json_path.replace("\\", "/"),
    }


def main() -> None:
    args = parse_args()
    playlist_html = fetch_html(args.playlist_url)
    playlist_title = extract_playlist_title(playlist_html)
    videos = extract_playlist_videos(playlist_html)
    if args.limit > 0:
        videos = videos[: args.limit]
    start_index = max(1, int(args.start_index))
    if start_index > 1:
        videos = videos[start_index - 1 :]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    talk_code_cache = {}
    video_match_cache = {}
    dataset_cache = {}
    manifest_items = []
    unmatched = []

    total = len(videos)
    absolute_total = start_index + total - 1
    for index, video in enumerate(videos, start=start_index):
        video_id = video["youtubeId"]
        video_title = video["youtubeTitle"]
        safe_print(f"[{index}/{absolute_total}] Matching: {video_title} ({video_id})")

        if video_id in video_match_cache:
            talk_url = video_match_cache[video_id]
        else:
            talk_url = match_ted_talk(video_id, video_title, talk_code_cache)
            video_match_cache[video_id] = talk_url
        if not talk_url:
            unmatched.append(video)
            safe_print("  -> No TED talk match")
            if args.sleep > 0:
                time.sleep(args.sleep)
            continue

        if talk_url in dataset_cache:
            dataset = dataset_cache[talk_url]
        else:
            slug_from_url = talk_url.rstrip("/").split("/talks/")[-1].split("?")[0]
            existing_json_path = output_dir / f"{slug_from_url}.json"
            if existing_json_path.exists():
                try:
                    dataset = json.loads(existing_json_path.read_text(encoding="utf-8"))
                    dataset_cache[talk_url] = dataset
                except Exception:
                    dataset = None
            else:
                dataset = None
            try:
                if dataset is None:
                    dataset = build_talk_dataset(talk_url, language_code="zh-cn")
                    dataset_cache[talk_url] = dataset
            except Exception as error:
                unmatched.append(video | {"reason": str(error)})
                safe_print(f"  -> Failed to build dataset: {error}")
                if args.sleep > 0:
                    time.sleep(args.sleep)
                continue

        slug = dataset["meta"]["slug"]
        dataset["meta"]["youtubeId"] = video_id
        dataset["meta"]["youtubeTitle"] = video_title
        talk_json_path = output_dir / f"{slug}.json"
        talk_js_path = output_dir / f"{slug}.js"
        talk_json_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
        talk_js_path.write_text(
            "window.TED_TALK_DATA = " + json.dumps(dataset, ensure_ascii=False, indent=2) + ";\n",
            encoding="utf-8",
        )

        manifest_items.append(
            build_manifest_entry(
                dataset=dataset,
                youtube_id=video_id,
                youtube_title=video_title,
                playlist_position=video.get("playlistPosition"),
                json_path=str(talk_json_path),
            )
        )
        safe_print(f"  -> Matched: {talk_url}")
        if args.sleep > 0:
            time.sleep(args.sleep)

    playlist_id = urllib.parse.parse_qs(urllib.parse.urlparse(args.playlist_url).query).get("list", [""])[0]
    manifest = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "playlist": {
            "id": playlist_id,
            "title": playlist_title,
            "url": args.playlist_url,
            "totalVideos": total,
            "matchedVideos": len(manifest_items),
            "unmatchedVideos": len(unmatched),
        },
        "items": manifest_items,
        "unmatched": unmatched,
    }

    write_json(args.manifest, manifest)
    write_js_manifest(args.manifest_js, manifest)
    safe_print(f"Saved manifest: {args.manifest}")
    safe_print(f"Saved manifest js: {args.manifest_js}")
    safe_print(f"Matched: {len(manifest_items)} / {total}")


if __name__ == "__main__":
    main()
