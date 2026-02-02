#!/usr/bin/env python3
import argparse
import json
import subprocess
from pathlib import Path


def build_filter(timeline):
    filter_parts = []
    mix_inputs = []
    for index, item in enumerate(timeline, start=1):
        delay = max(0, int(item.get("startMs", 0)))
        label = f"a{index}"
        filter_parts.append(f"[{index}:a]adelay={delay}:all=1[{label}]")
        mix_inputs.append(f"[{label}]")
    if not mix_inputs:
        return None
    filter_parts.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:normalize=0[a]")
    return ";".join(filter_parts)


def main():
    parser = argparse.ArgumentParser(
        description="Mux walkthrough video with multiple audio snippets using a timeline.")
    parser.add_argument("--video", required=True, help="Path to input video")
    parser.add_argument("--timeline", required=True, help="Path to timeline.json")
    parser.add_argument("--audio-dir", required=True, help="Directory containing snippet audio files")
    parser.add_argument("--output", required=True, help="Path to output video")
    args = parser.parse_args()

    timeline_path = Path(args.timeline)
    audio_dir = Path(args.audio_dir)
    timeline = json.loads(timeline_path.read_text())

    audio_files = []
    for item in timeline:
        name = item.get("file")
        if not name:
            raise SystemExit("Timeline entries must include a 'file' field")
        path = audio_dir / name
        if not path.exists():
            raise SystemExit(f"Missing audio file: {path}")
        audio_files.append(str(path))

    filter_complex = build_filter(timeline)
    if not filter_complex:
        raise SystemExit("Timeline is empty; nothing to mux")

    cmd = ["ffmpeg", "-y", "-i", args.video]
    for audio in audio_files:
        cmd.extend(["-i", audio])
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        args.output,
    ])

    print(cmd)

    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
