#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ICL Flow runner

Usage examples:
  python tasks/run_icl_flow.py --anchor_policy latest_success --top_k 3
"""

import os
import json
import argparse
from datetime import datetime
from collections import Counter
from math import sqrt
import re

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CSD_PATH = os.path.join(PROJECT_ROOT, 'csd_data.json')
ICL_OUT_DIR = os.path.join(PROJECT_ROOT, 'icl_runs')


def load_csd_library():
    if not os.path.exists(CSD_PATH):
        raise FileNotFoundError(f"CSD library not found: {CSD_PATH}")
    with open(CSD_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def pick_anchor(csd_lib, policy='latest_success', task_id=None):
    if policy == 'by_task_id':
        if not task_id or task_id not in csd_lib:
            raise ValueError('anchor_task_id not found in CSD library')
        return task_id, csd_lib[task_id]

    # latest_success: pick max generated_at
    best_id = None
    best_ts = ''
    for tid, obj in csd_lib.items():
        ts = obj.get('generated_at', '')
        if ts > best_ts:
            best_ts = ts
            best_id = tid
    if not best_id:
        raise ValueError('No CSD entries found for anchor selection')
    return best_id, csd_lib[best_id]


def flatten_attr(attr_obj):
    if not isinstance(attr_obj, dict):
        return ''
    parts = []
    for name, meta in attr_obj.items():
        if not isinstance(meta, dict):
            continue
        color = meta.get('color', '')
        shape = meta.get('shape', '')
        texture = meta.get('texture', '')
        parts.append(f"{name}: color={color}; shape={shape}; texture={texture}")
    return '\n'.join(parts)


def flatten_func(func_obj):
    if not isinstance(func_obj, dict):
        return ''
    parts = []
    for name, desc in func_obj.items():
        parts.append(f"{name}: {desc}")
    return '\n'.join(parts)


def flatten_inter(inter_obj):
    if not isinstance(inter_obj, dict):
        return ''
    detailed = inter_obj.get('detailed', '')
    summary = inter_obj.get('summary', '')
    hist = inter_obj.get('hist', [])
    hist_text = '\n'.join(hist) if isinstance(hist, list) else str(hist)
    return f"{detailed}\n{summary}\n{hist_text}"


def bow(text):
    words = []
    for token in (text or '').lower().split():
        # very light normalization
        token = ''.join(ch for ch in token if ch.isalnum() or ch in ('_', '-'))
        if token:
            words.append(token)
    return Counter(words)


def cosine(c1: Counter, c2: Counter) -> float:
    if not c1 or not c2:
        return 0.0
    inter = set(c1.keys()) & set(c2.keys())
    num = sum(c1[k] * c2[k] for k in inter)
    d1 = sqrt(sum(v*v for v in c1.values()))
    d2 = sqrt(sum(v*v for v in c2.values()))
    if d1 == 0.0 or d2 == 0.0:
        return 0.0
    return num / (d1 * d2)


def five_dim_texts(csd_obj):
    return {
        'attr': flatten_attr(csd_obj.get('attr', {})),
        'struct': csd_obj.get('struct', '') or '',
        'func': flatten_func(csd_obj.get('func', {})),
        'proc': csd_obj.get('proc', '') or '',
        'inter': flatten_inter(csd_obj.get('Inter', {})),
    }


def retrieve_top_k(csd_lib, anchor_id, anchor_obj, top_k=3, weights=None):
    weights = weights or {"attr":1, "struct":1, "func":1, "proc":1, "inter":1}
    a_texts = five_dim_texts(anchor_obj)
    a_bows = {k: bow(v) for k, v in a_texts.items()}

    scored = []
    for tid, obj in csd_lib.items():
        if tid == anchor_id:
            continue
        t_texts = five_dim_texts(obj)
        t_bows = {k: bow(v) for k, v in t_texts.items()}
        sims = {k: cosine(a_bows[k], t_bows[k]) for k in a_bows.keys()}
        score = sum(weights.get(k, 1) * sims[k] for k in sims.keys())
        scored.append((tid, score, sims))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def build_icl_context_full(anchor_id, anchor_obj, csd_lib, examples):
    """Build context with full CSD data (anchor plus Top-K examples)."""
    full_examples = []
    for tid, score, sims in examples:
        example_csd = csd_lib.get(tid, {})
        full_examples.append({
            'task_id': tid,
            'score': score,
            'dim_scores': sims,
            'csd': example_csd
        })
    return {
        'anchor_task_id': anchor_id,
        'anchor_csd': anchor_obj,
        'examples': full_examples
    }


def build_action_sequence_prompt(context_obj):
    """Build a schema-constrained action-sequence prompt from context."""
    anchor_id = context_obj['anchor_task_id']
    anchor = context_obj['anchor_csd']
    examples = context_obj['examples']

    def compact(csd):
        return {
            'meta': csd.get('meta', {}),
            'attr': csd.get('attr', {}),
            'struct': csd.get('struct', ''),
            'func': csd.get('func', {}),
            'proc': csd.get('proc', ''),
            'Inter': csd.get('Inter', {})
        }

    parts = []
    parts.append(
        "You are an expert Minecraft agent planner and analogy reasoner. "
        "Given a reference task (ANCHOR) and K analogous tasks (each with CSD: meta/attr/struct/func/proc/Inter), "
        "perform analogy-driven induction to propose a NEW task that is not the same as the anchor.\n\n"
        "Analogy guidance examples:\n"
        "- If the anchor crafts 'copper tools', infer 'iron tools' by substituting materials and adjusting prerequisites.\n"
        "- If the anchor smelts ore A with fuel F, infer smelting plan for ore B with proper furnace/steps.\n\n"
        "Your output MUST be a single JSON object with this schema (and nothing else):\n"
        "{\n"
        "  \"new_task\": {\n"
        "    \"name\": \"<short name>\",\n"
        "    \"goal\": \"<one-line goal different from the anchor>\",\n"
        "    \"materials_map\": { \"from_material\": \"to_material\", ... },\n"
        "    \"prerequisites\": [\"<pre-step or tool requirement>\", ...]\n"
        "  },\n"
        "  \"action_sequence\": [\"<step-1>\", \"<step-2>\", ...]\n"
        "}\n\n"
        "Constraints:\n"
        "- The new_task.goal MUST be different from the anchor's goal (do not restate sticks if anchor crafts sticks).\n"
        "- Provide a meaningful materials_map for the analogy (e.g., copper->iron, oak_log->birch_log, etc.) when applicable.\n"
        "- Steps must be concise and executable by an agent using navigation/mining/crafting/placing/smelting.\n"
        "- No extra commentary or fields beyond the schema."
    )

    parts.append("\nREFERENCE TASK (ANCHOR):\nTask ID: %s\nCSD:\n%s" % (anchor_id, json.dumps(compact(anchor), ensure_ascii=False, indent=2)))
    for i, ex in enumerate(examples, 1):
        parts.append("\nEXAMPLE %d:\nTask ID: %s\nscore: %.3f\nCSD:\n%s" % (
            i, ex['task_id'], ex['score'], json.dumps(compact(ex['csd']), ensure_ascii=False, indent=2)
        ))

    parts.append("\nNow infer a NEW task via analogy and produce the JSON strictly following the schema above.")
    return '\n\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(description='Run ICL retrieval and context construction')
    parser.add_argument('--anchor_policy', default='latest_success', choices=['latest_success', 'by_task_id'])
    parser.add_argument('--anchor_task_id', default=None)
    parser.add_argument('--top_k', type=int, default=3)
    parser.add_argument('--weights', type=str, default='{"attr":1,"struct":1,"func":1,"proc":1,"inter":1}')
    args = parser.parse_args()

    csd_lib = load_csd_library()
    anchor_id, anchor_obj = pick_anchor(csd_lib, args.anchor_policy, args.anchor_task_id)

    try:
        weights = json.loads(args.weights)
    except Exception:
        weights = {"attr":1, "struct":1, "func":1, "proc":1, "inter":1}

    examples_scored = retrieve_top_k(csd_lib, anchor_id, anchor_obj, top_k=args.top_k, weights=weights)

    # Print summary
    print(f"Anchor task: {anchor_id}")
    for i, (tid, score, sims) in enumerate(examples_scored, 1):
        sims_str = ', '.join(f"{k}:{sims[k]:.3f}" for k in ['attr','struct','func','proc','inter'])
        print(f"Top-{i}: {tid} | score={score:.3f} | {sims_str}")

    # Save Top-K retrieval results in a dedicated subdirectory per run.
    os.makedirs(ICL_OUT_DIR, exist_ok=True)
    ts = datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%SZ')
    run_dir = os.path.join(ICL_OUT_DIR, f"run_{ts}")
    os.makedirs(run_dir, exist_ok=True)
    out_fp = os.path.join(run_dir, "retrieval.json")
    out = {
        'anchor_task_id': anchor_id,
        'top_k': args.top_k,
        'weights': weights,
        'examples': [
            {
                'task_id': tid,
                'score': score,
                'dim_scores': sims
            } for (tid, score, sims) in examples_scored
        ]
    }
    with open(out_fp, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"Saved ICL retrieval result to {out_fp}")

    # Build full context including complete CSD data.
    ctx_full = build_icl_context_full(anchor_id, anchor_obj, csd_lib, examples_scored)
    ctx_fp = os.path.join(run_dir, "context.json")
    with open(ctx_fp, 'w', encoding='utf-8') as f:
        json.dump(ctx_full, f, indent=2, ensure_ascii=False)
    print(f"Saved full ICL context to {ctx_fp}")

    # Always generate the action-sequence prompt file.
    prompt_txt = build_action_sequence_prompt(ctx_full)
    prompt_fp = os.path.join(run_dir, "prompt.txt")
    with open(prompt_fp, 'w', encoding='utf-8') as f:
        f.write(prompt_txt)
    print(f"Saved action-sequence prompt to {prompt_fp}")

    # Always call the LLM to generate action-sequence JSON.
    actions_fp = os.path.join(run_dir, "actions.json")
    node_script = os.path.join(PROJECT_ROOT, 'tasks', 'icl_induce.js')
    cmd = f"node {node_script} --prompt_file {prompt_fp} --out {actions_fp}"
    print('[ICL] Running:', cmd)
    code = os.system(cmd)
    if code != 0:
        print('[ICL] Induction failed with code', code)
    else:
        print(f"Saved induced actions to {actions_fp}")

    # Generate a runnable task file (task.json) from actions.json and inject action guidance into the goal.
    try:
        with open(actions_fp, 'r', encoding='utf-8') as f:
            actions_obj = json.load(f)
        new_task = actions_obj.get('new_task', {})
        action_sequence = actions_obj.get('action_sequence', [])

        task_name = new_task.get('name', 'icl_induced_task')
        task_goal = new_task.get('goal', 'Run induced task')

        # Infer the target from keywords such as *_pickaxe or *_ingot in the goal, materials_map, and action sequence.
        target = None
        # 1) Extract snake_case words from the goal.
        m = re.findall(r"[a-z_]+", task_goal.lower())
        candidates = [w for w in m if '_' in w]
        for c in candidates:
            if any(s in c for s in ['pickaxe','sword','axe','ingot','block','planks','stick','table','furnace']):
                target = c
                break
        # 2) Guess from materials_map values.
        if not target:
            for v in (new_task.get('materials_map') or {}).values():
                if isinstance(v, str) and any(k in v for k in ['pickaxe','ingot','block','planks','stick']):
                    target = v
                    break
        # 3) Extract from the end of the action sequence.
        if not target and action_sequence:
            last = action_sequence[-1].lower()
            for key in ['stone_pickaxe','iron_pickaxe','wooden_pickaxe','diamond_pickaxe','stick','oak_planks','iron_ingot']:
                if key in last:
                    target = key
                    break
        if not target:
            target = task_name.replace('crafting_', '')

        # Inject the action sequence into the goal as execution guidance.
        guidance = ''
        if action_sequence:
            bullets = '\n'.join(f"- {step}" for step in action_sequence)
            guidance = f"\nAction Guidance (follow these steps if applicable):\n{bullets}"

        task_entry = {
            task_name: {
                "goal": task_goal + guidance,
                "initial_inventory": {},
                "agent_count": 1,
                "target": target,
                "number_of_target": 1,
                "type": "techtree",
                "timeout": 500
            }
        }

        task_fp = os.path.join(run_dir, 'task.json')
        with open(task_fp, 'w', encoding='utf-8') as f:
            json.dump(task_entry, f, indent=2, ensure_ascii=False)
        print(f"Saved induced runnable task to {task_fp}")

        # Run the new task directly using the existing profiles settings.
        cmd_run = f"node {os.path.join(PROJECT_ROOT, 'main.js')} --task_path {task_fp} --task_id {task_name}"
        print('[ICL] Running induced task:', cmd_run)
        os.system(cmd_run)

    except Exception as e:
        print('[ICL] Failed to generate or run induced task:', e)


if __name__ == '__main__':
    raise SystemExit(main())

