import argparse
import json
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("talk_url")
    parser.add_argument("-o", "--output", default="data/ted-talk.json")
    parser.add_argument("--js-output", default="data/ted-talk.js")
    return parser.parse_args()


def fetch_html(url: str, retries: int = 3, timeout: int = 30) -> str:
    last_error = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except Exception as error:
            last_error = error
            if attempt < retries:
                time.sleep(0.6 * attempt)
    raise RuntimeError(f"Failed to fetch URL after retries: {url}") from last_error


def add_language_query(url: str, language_code: str) -> str:
    parsed = urlparse(url)
    query_pairs = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query_pairs["language"] = language_code
    return urlunparse(parsed._replace(query=urlencode(query_pairs)))


def extract_next_data(html: str) -> dict:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.S,
    )
    if not match:
        raise RuntimeError("Cannot find __NEXT_DATA__ in TED page.")
    return json.loads(match.group(1))


def build_cues(paragraphs: list, duration: float) -> list:
    cues = []
    for paragraph in paragraphs:
        for cue in paragraph["cues"]:
            text = " ".join(cue["text"].replace("\n", " ").split())
            cues.append({"start": cue["time"] / 1000, "text": text})
    for index, cue in enumerate(cues):
        next_start = cues[index + 1]["start"] if index + 1 < len(cues) else duration
        cue["end"] = max(cue["start"] + 0.3, next_start - 0.05)
    return cues


def build_sentences(cues: list) -> list:
    sentences = []
    sentence_start = None
    sentence_cue_start = None
    parts = []
    for index, cue in enumerate(cues):
        if sentence_start is None:
            sentence_start = cue["start"]
            sentence_cue_start = index
        parts.append(cue["text"])
        text = " ".join(parts).strip()
        is_sentence_end = bool(re.search(r'[.!?]["”’\']?$', text))
        if is_sentence_end or index == len(cues) - 1:
            sentences.append(
                {
                    "id": len(sentences) + 1,
                    "start": round(sentence_start, 3),
                    "end": round(cue["end"], 3),
                    "text": text,
                    "_cueStart": sentence_cue_start,
                    "_cueEnd": index,
                }
            )
            sentence_start = None
            sentence_cue_start = None
            parts = []
    return sentences


def align_translations(sentences: list, translated_cues: list) -> None:
    for sentence in sentences:
        cue_start = sentence.get("_cueStart")
        cue_end = sentence.get("_cueEnd")
        selected = []
        if (
            isinstance(cue_start, int)
            and isinstance(cue_end, int)
            and cue_start >= 0
            and cue_end >= cue_start
            and cue_end < len(translated_cues)
        ):
            selected = [translated_cues[index]["text"] for index in range(cue_start, cue_end + 1)]
        if not selected:
            start = sentence["start"]
            end = sentence["end"]
            selected = [
                cue["text"]
                for cue in translated_cues
                if cue["start"] <= end + 0.1 and cue["end"] >= start - 0.1
            ]
        sentence["translation"] = "".join(selected).strip()

    for sentence in sentences:
        sentence.pop("_cueStart", None)
        sentence.pop("_cueEnd", None)


def safe_extract_paragraphs(next_data: dict) -> list:
    return (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("transcriptData", {})
        .get("translation", {})
        .get("paragraphs", [])
    )


def build_output(next_data_en: dict, next_data_zh: dict, talk_url: str, zh_url: str) -> dict:
    page_props = next_data_en["props"]["pageProps"]
    video_data = page_props["videoData"]
    transcript_data_en = safe_extract_paragraphs(next_data_en)
    player_data = json.loads(video_data["playerData"])
    duration = video_data["duration"]
    cues = build_cues(transcript_data_en, duration)
    sentences = build_sentences(cues)
    transcript_data_zh = safe_extract_paragraphs(next_data_zh) if next_data_zh else []
    cues_zh = build_cues(transcript_data_zh, duration) if transcript_data_zh else []
    if cues_zh:
        align_translations(sentences, cues_zh)
    else:
        for sentence in sentences:
            sentence["translation"] = ""
    audio_url = player_data["resources"]["h264"][0]["file"]
    return {
        "meta": {
            "title": video_data["title"],
            "speaker": video_data["presenterDisplayName"],
            "duration": duration,
            "slug": video_data["slug"],
            "sourcePage": talk_url,
            "translationSourcePage": zh_url,
            "audioUrl": audio_url,
        },
        "sentences": sentences,
        "cues": cues,
        "cuesZh": cues_zh,
    }


def build_talk_dataset(talk_url: str, language_code: str = "zh-cn") -> dict:
    html_en = fetch_html(talk_url)
    next_data_en = extract_next_data(html_en)
    translation_url = add_language_query(talk_url, language_code)
    next_data_translation = None
    try:
        html_translation = fetch_html(translation_url)
        next_data_translation = extract_next_data(html_translation)
    except Exception:
        next_data_translation = None
    return build_output(next_data_en, next_data_translation, talk_url, translation_url)


def save_dataset(output_data: dict, output_path: str, js_output_path: str) -> None:
    json_path = Path(output_path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(output_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    js_path = Path(js_output_path)
    js_path.parent.mkdir(parents=True, exist_ok=True)
    js_path.write_text(
        "window.TED_TALK_DATA = "
        + json.dumps(output_data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    output_data = build_talk_dataset(args.talk_url)
    save_dataset(output_data, args.output, args.js_output)
    print(f"Saved: {args.output}")
    print(f"Saved: {args.js_output}")
    print(f"Sentences: {len(output_data['sentences'])}")
    print(f"Cues: {len(output_data['cues'])}")
    print(f"Chinese cues: {len(output_data['cuesZh'])}")


if __name__ == "__main__":
    main()
