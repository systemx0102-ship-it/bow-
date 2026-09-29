-- Lunar Bow: prepare an R15 rig so the Animation Editor can show/edit the bow joint.
-- 1) Insert the three package files and put the imported meshes in StarterPack.LunarBow.BowModel.
-- 2) Create a rig (Avatar tab > Rig Builder > Block Rig R15) and SELECT it in the Explorer.
-- 3) Paste this script into View > Command Bar and press Enter.
-- The rig gets a "BowHandle" part joined to LeftHand by the Motor6D "BowGrip" (the same joint the
-- Tool creates in game), with the bow welded to it. Then open the Animation Editor on the rig and
-- use "..." > Import > From File... with any animations/LunarBow_*.rbxmx.

local Selection = game:GetService("Selection")
local rig = Selection:Get()[1]
assert(rig and rig:IsA("Model") and rig:FindFirstChild("LeftHand"), "Select an R15 rig model first")

local Shared = game:GetService("ReplicatedStorage"):WaitForChild("LunarBowShared")
local BowAssembly = require(Shared:WaitForChild("BowAssembly"))
local tool = game:GetService("StarterPack"):FindFirstChild("LunarBow")
assert(tool, "Insert LunarBow.rbxmx into StarterPack first")

local old = rig:FindFirstChild("LunarBowPreview")
if old then
	old:Destroy()
end

local copy = tool:Clone()
for _, d in copy:GetDescendants() do
	if d:IsA("LuaSourceContainer") or d:IsA("RemoteEvent") then
		d:Destroy()
	end
end
BowAssembly.assemble(copy)
local motor = BowAssembly.attachToHand(copy, rig)
local holder = Instance.new("Model")
holder.Name = "LunarBowPreview"
for _, c in copy:GetChildren() do
	c.Parent = holder
end
holder.Parent = rig
copy:Destroy()
print("[LunarBow] Rig ready:", rig:GetFullName(), motor and "(BowGrip created)" or "(no LeftHand?)")
