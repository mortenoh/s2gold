#!/usr/bin/env bash
# Generate AI remasters for the references of one archive on a GPU host.
#
#   scripts/remaster-gen.sh rom_z [host]
#
# Copies remaster/<archive>/ref/*.png to the host, runs Qwen Image 2.1 editing with the
# 4-step acceleration LoRA through stable-diffusion.cpp for every reference that has no
# output yet, and copies the results back to remaster/<archive>/out/. Re-running resumes.
# Host paths are overridable: SD_CLI, MODELS (holding the Qwen Image 2.1 files and loras/);
# PROMPT replaces the edit instruction, which otherwise comes from remaster/<archive>/jobs.json
# (written by remaster-prep; winter sets get a snow-keeping variant).
set -euo pipefail
ARCHIVE=${1:?archive name, e.g. rom_z}
HOST=${2:-msai}
SIZE=${SIZE:-512}
SD_CLI=${SD_CLI:-'~/dev/stable-diffusion.cpp/build/bin/sd-cli'}
MODELS=${MODELS:-/data/lab/models/image}
ROOT=$(cd "$(dirname "$0")/.." && pwd)/remaster/$ARCHIVE
REMOTE=s2gold-remaster/$ARCHIVE
[ -n "${PROMPT:-}" ] && PROMPT_SET=1
PROMPT=${PROMPT:-"Redraw this low-resolution pixel-art game sprite as a high-resolution, detailed hand-painted illustration. Keep exactly the same object, layout, silhouette, proportions, isometric viewing angle, colours and every detail. Remove the pixelation and blockiness. Keep the flat solid magenta background exactly as it is."}

if [ -z "${PROMPT_SET:-}" ] && [ -f "$ROOT/jobs.json" ]; then
  JOB_PROMPT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("prompt", ""))' "$ROOT/jobs.json")
  [ -n "$JOB_PROMPT" ] && PROMPT=$JOB_PROMPT
fi
[ -d "$ROOT/ref" ] || { echo "no references: run 'uv run s2gold remaster-prep $ARCHIVE' first" >&2; exit 1; }
mkdir -p "$ROOT/out"
ssh "$HOST" "mkdir -p $REMOTE/ref $REMOTE/out"
rsync -a "$ROOT/ref/" "$HOST:$REMOTE/ref/"
rsync -a "$ROOT/out/" "$HOST:$REMOTE/out/"
ssh "$HOST" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd $REMOTE
for ref in ref/*.png; do
  out=out/\$(basename "\$ref")
  [ -f "\$out" ] && continue
  start=\$(date +%s)
  $SD_CLI --diffusion-model $MODELS/qwen_image_2.1-Q8_0.gguf \
    --vae $MODELS/qwen_image_2.1_vae_bf16.safetensors \
    --llm $MODELS/Qwen3VL-8B-Instruct-Q8_0.gguf \
    --llm_vision $MODELS/mmproj-Qwen3VL-8B-Instruct-F16.gguf \
    --lora-model-dir $MODELS/loras -r "\$ref" -p "$PROMPT <lora:qwen21-acc-4step:1>" \
    --cfg-scale 1.0 --steps 4 --sampling-method euler -W $SIZE -H $SIZE --diffusion-fa \
    -o "\$out.tmp.png" > "\$out.log" 2>&1 && mv "\$out.tmp.png" "\$out"
  echo "\$(basename "\$ref") \$(( \$(date +%s) - start ))s"
done
REMOTE_SCRIPT
rsync -a --exclude '*.log' "$HOST:$REMOTE/out/" "$ROOT/out/"
echo "outputs in $ROOT/out ($(ls "$ROOT/out" | wc -l | tr -d ' ') files)"
