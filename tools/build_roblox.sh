#!/usr/bin/env sh
# Rebuild the ready-to-insert Roblox files with Rojo (https://rojo.space).
set -e
cd "$(dirname "$0")/.."
mkdir -p roblox/build
rojo build roblox/tool.project.json   -o roblox/build/LunarBow.rbxmx
rojo build roblox/shared.project.json -o roblox/build/LunarBowShared.rbxmx
rojo build roblox/fx.project.json     -o roblox/build/LunarBowFX.rbxmx
rojo build default.project.json       -o roblox/build/LunarBow_Demo.rbxlx
echo "Built into roblox/build/"
