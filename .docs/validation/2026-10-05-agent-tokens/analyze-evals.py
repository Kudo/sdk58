"""Summarize existing eval traces without copying raw conversation content."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def events(path):
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        event = row.get("event", row)
        if isinstance(event, dict):
            yield event


def output_text(event):
    output = event.get("rawOutput")
    if isinstance(output, str):
        return output
    if isinstance(output, dict):
        if isinstance(output.get("output_for_prompt"), str):
            return output["output_for_prompt"]
        return "\n".join(str(output.get(key) or "") for key in ("stdout", "stderr"))
    parts = []
    for block in event.get("content") or []:
        if not isinstance(block, dict):
            continue
        content = block.get("content", block)
        if isinstance(content, dict) and isinstance(content.get("text"), str):
            parts.append(content["text"])
    return "\n".join(parts)


def summarize(run):
    stream = run / "stream.ndjson"
    totals = {key: 0 for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "reasoning_tokens", "total_tokens")}
    calls = 0
    tools = {}
    updates = {}
    costs = []
    for event in events(stream):
        if event.get("type") == "usage" and isinstance(event.get("usage"), dict):
            usage = event["usage"]
            calls += 1
            for key in totals:
                if key != "total_tokens":
                    totals[key] += int(usage.get(key) or 0)
            total = usage.get("total_tokens")
            if total is None:
                total = sum(int(usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
            totals["total_tokens"] += int(total)
        elif event.get("type") == "end" and event.get("total_cost_usd") is not None:
            costs.append(float(event["total_cost_usd"]))
        elif event.get("type") == "tool_call":
            tools[event.get("toolCallId")] = event
        elif event.get("type") == "tool_call_update":
            key = event.get("toolCallId")
            text = output_text(event)
            if len(text) > len(updates.get(key, "")):
                updates[key] = text
    records = []
    simulator_calls = image_reads = 0
    for key, event in tools.items():
        raw = event.get("rawInput") or {}
        if not isinstance(raw, dict):
            continue
        command = str(raw.get("command") or "")
        name = event.get("toolName")
        path = str(raw.get("path") or raw.get("file_path") or "")
        simulator_calls += bool(re.search(r"\bagent-device\b|\bsimctl\s+io\b.*\bscreenshot\b", command))
        image_reads += bool(name in ("read_file", "Read") and path.lower().endswith(".png"))
        match = re.search(r"\brn-a11y-tree\s+(test|render|run|check|schema|skill)\b", command)
        if not match:
            continue
        output = updates.get(key, "")
        records.append({
            "command": match[1],
            "help": bool(re.search(r"(?:^|\s)(?:--help|-h)(?:\s|$)", command)),
            "name_filter": bool(re.search(r"(?:^|\s)(?:-t|--testNamePattern)(?:\s|=)", command)),
            "largest_output_update_bytes": len(output.encode()),
            "output_sha256": hashlib.sha256(output.encode()).hexdigest(),
            "passed_summary": bool(re.search(r"Tests\s+\d+\s+passed", output)),
            "failed_summary": bool(re.search(r"Tests\s+\d+\s+failed|\bFAIL\b", output)),
        })
    meta = json.loads((run / "meta.json").read_text()) if (run / "meta.json").exists() else {}
    test_calls = [record for record in records if record["command"] == "test"]
    return {
        "run": run.name,
        "trace_sha256": hashlib.sha256(stream.read_bytes()).hexdigest(),
        "model": meta.get("model"), "skill_sha256": meta.get("skill_sha"), "done": meta.get("done"),
        "wall_s": meta.get("wall_s"), "outside_build_s": meta.get("wall_ex_build_s"),
        "model_calls": calls, **totals,
        "cache_read_fraction": totals["cache_read_input_tokens"] / totals["total_tokens"] if totals["total_tokens"] else None,
        "cost_usd": max(costs) if costs else None,
        "simulator_commands": simulator_calls, "image_reads": image_reads,
        "test_command_calls": len(test_calls),
        "test_help_calls": sum(record["help"] for record in test_calls),
        "test_execution_calls": sum(not record["help"] for record in test_calls),
        "filtered_test_execution_calls": sum(record["name_filter"] and not record["help"] for record in test_calls),
        "tool_outputs": records,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("eval_home", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    summaries = [summarize(path.parent) for path in sorted((args.eval_home / "runs").glob("*/stream.ndjson"))]
    result = {
        "method": "Sum incremental usage events once; never add end.usage again. Reasoning is reported separately, not added to provided total. Tool bytes are the largest output update for each call, not a token attribution or the cumulative transcript. No raw tool text is copied.",
        "runs": summaries,
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    for run in summaries:
        print(f"{run['run']}: {run['total_tokens']:,} tokens; {run['cache_read_fraction']:.1%} cache read; {run['test_execution_calls']} test executions + {run['test_help_calls']} test help; {run['simulator_commands']} simulator commands")


if __name__ == "__main__":
    main()
