-- Lunar Bow: create the PBR SurfaceAppearances from Studio's COMMAND BAR.
-- 1) Upload the 12 PNGs from model/textures with Asset Manager > Bulk Import.
-- 2) Right-click each image > Copy Asset ID and paste the ids below.
-- 3) Paste this whole script into View > Command Bar and press Enter.
-- (SurfaceAppearance maps can only be set from Studio, not from game scripts.)

local ids = {
	Limbs = { Color = "", Normal = "", Roughness = "", Metalness = "" }, -- Body_*.png
	Armor = { Color = "", Normal = "", Roughness = "", Metalness = "" }, -- Armor_*.png
	Grip = { Color = "", Normal = "", Roughness = "", Metalness = "" }, -- Grip_*.png
}

local function asset(id: string): string
	if id:match("^%d+$") then
		return "rbxassetid://" .. id
	end
	return id
end

local tool = game:GetService("StarterPack"):FindFirstChild("LunarBow")
assert(tool, "Put the LunarBow Tool in StarterPack first")
for name, maps in ids do
	local part = tool:FindFirstChild(name, true)
	if part and part:IsA("MeshPart") then
		local sa = part:FindFirstChildOfClass("SurfaceAppearance") or Instance.new("SurfaceAppearance")
		sa.ColorMap = asset(maps.Color)
		sa.NormalMap = asset(maps.Normal)
		sa.RoughnessMap = asset(maps.Roughness)
		sa.MetalnessMap = asset(maps.Metalness)
		sa.Parent = part
		print("[LunarBow] SurfaceAppearance ->", part:GetFullName())
	else
		warn("[LunarBow] MeshPart not found:", name)
	end
end
