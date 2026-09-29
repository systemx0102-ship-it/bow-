--!strict
-- Turns the imported MeshParts inside the Tool into a ready-to-use bow:
-- sizes/positions them from BowLayout (so the import unit does not matter),
-- welds everything to an invisible "BowHandle", styles the materials and adds
-- the string (Beams), light, particles and swing trails.
--
-- Expected MeshParts anywhere inside the Tool (names from LunarBow.fbx):
--   Limbs, Armor, Grip, Crystals, Aura
-- If they are missing, a primitive placeholder is built so the tool still works.

local CollectionService = game:GetService("CollectionService")

local Config = require(script.Parent.Config)
local Layout = require(script.Parent.BowLayout)

local BowAssembly = {}

BowAssembly.Tag = "LunarBow"
BowAssembly.MeshNames = { "Limbs", "Armor", "Grip", "Crystals", "Aura" }
BowAssembly.SparkleTexture = "rbxasset://textures/particles/sparkles_main.dds"

local function findPart(root: Instance, name: string): BasePart?
	local exact = root:FindFirstChild(name, true)
	if exact and exact:IsA("BasePart") then
		return exact
	end
	local lname = name:lower()
	for _, d in root:GetDescendants() do
		if d:IsA("BasePart") and d.Name:lower():find(lname, 1, true) then
			return d
		end
	end
	return nil
end

local function quiet(part: BasePart)
	part.Anchored = false
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
end

local function weld(handle: BasePart, part: BasePart, offset: CFrame)
	part.CFrame = handle.CFrame * offset
	local w = Instance.new("Weld")
	w.Name = "BowWeld"
	w.Part0 = handle
	w.Part1 = part
	w.C0 = offset
	w.Parent = part
end

local function style(name: string, part: BasePart)
	local hasSA = part:FindFirstChildOfClass("SurfaceAppearance") ~= nil
	part.CastShadow = name ~= "Aura" and name ~= "Crystals"
	if name == "Crystals" then
		part.Material = Enum.Material.Neon
		part.Color = Config.Colors.Glow
	elseif name == "Aura" then
		part.Material = Enum.Material.ForceField
		part.Color = Config.Colors.GlowDeep
		part.Transparency = Config.AuraIdleTransparency
	elseif not hasSA then
		if name == "Limbs" then
			part.Material = Enum.Material.Metal
			part.Color = Config.Colors.Body
		elseif name == "Armor" then
			part.Material = Enum.Material.Metal
			part.Color = Config.Colors.Gold
		elseif name == "Grip" then
			part.Material = Enum.Material.Fabric
			part.Color = Config.Colors.Grip
		end
		local tex = (Config.TextureIds :: { [string]: string })[name]
		if tex and tex ~= "" and part:IsA("MeshPart") then
			part.TextureID = tex
		end
	end
end

local function buildPlaceholder(handle: BasePart, parent: Instance, scale: number)
	-- a chain of cylinders along the limb centreline + gold caps and a glowing core
	local model = Instance.new("Model")
	model.Name = "PlaceholderBow"
	local pts = Layout.Centerline
	for i = 1, #pts - 1 do
		local a, b = pts[i].Position * scale, pts[i + 1].Position * scale
		local mid, len = (a + b) / 2, (b - a).Magnitude
		local r = (pts[i].Radius + pts[i + 1].Radius) * scale
		local seg = Instance.new("Part")
		seg.Name = "Limb" .. i
		seg.Shape = Enum.PartType.Cylinder
		seg.Size = Vector3.new(len + r * 0.5, r * 1.6, r * 1.6)
		seg.Material = Enum.Material.Metal
		seg.Color = Config.Colors.Body
		quiet(seg)
		-- cylinder axis is X: aim it along the segment
		local offset = CFrame.lookAt(mid, b) * CFrame.Angles(0, math.rad(90), 0)
		weld(handle, seg, offset)
		seg.Parent = model
		if i % 4 == 0 then
			local band = seg:Clone()
			band.Name = "Band" .. i
			band.Size = Vector3.new(r * 0.9, r * 2.3, r * 2.3)
			band.Color = Config.Colors.Gold
			band:ClearAllChildren()
			weld(handle, band, offset)
			band.Parent = model
		end
	end
	local core = Instance.new("Part")
	core.Name = "Crystals"
	core.Shape = Enum.PartType.Ball
	core.Size = Vector3.one * 0.22 * scale
	core.Material = Enum.Material.Neon
	core.Color = Config.Colors.Glow
	quiet(core)
	weld(handle, core, CFrame.new(Layout.Points.CoreLight * scale))
	core.Parent = model
	model.Parent = parent
end

local function attachment(handle: BasePart, name: string, pos: Vector3): Attachment
	local a = Instance.new("Attachment")
	a.Name = name
	a.Position = pos
	a.Parent = handle
	return a
end

local function beam(name: string, a0: Attachment, a1: Attachment, width: number, transparency: number): Beam
	local b = Instance.new("Beam")
	b.Name = name
	b.Attachment0 = a0
	b.Attachment1 = a1
	b.Width0 = width
	b.Width1 = width
	b.FaceCamera = true
	b.Segments = 1
	b.LightEmission = 1
	b.LightInfluence = 0
	b.Color = ColorSequence.new(Config.Colors.Glow)
	b.Transparency = NumberSequence.new(transparency)
	pcall(function()
		(b :: any).Brightness = 3
	end)
	b.Parent = a0.Parent
	return b
end

local function trail(name: string, a0: Attachment, a1: Attachment): Trail
	local t = Instance.new("Trail")
	t.Name = name
	t.Attachment0 = a0
	t.Attachment1 = a1
	t.Lifetime = 0.22
	t.MinLength = 0.05
	t.LightEmission = 1
	t.LightInfluence = 0
	t.Color = ColorSequence.new(Config.Colors.Charged, Config.Colors.GlowDeep)
	t.Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.15),
		NumberSequenceKeypoint.new(1, 1),
	})
	t.WidthScale = NumberSequence.new(1, 0.15)
	t.Enabled = false
	t.Parent = a0.Parent
	return t
end

-- Returns the BowHandle. Safe to call more than once.
function BowAssembly.assemble(tool: Tool): BasePart
	local existing = tool:FindFirstChild("BowHandle")
	if existing and existing:IsA("BasePart") and tool:GetAttribute("LunarBowAssembled") then
		return existing
	end
	local scale = Config.BowScale

	local handle = Instance.new("Part")
	handle.Name = "BowHandle"
	handle.Size = Vector3.one * 0.2
	handle.Transparency = 1
	quiet(handle)
	handle.CFrame = CFrame.new(0, 50, 0)
	handle.Parent = tool

	local folder = tool:FindFirstChild("BowModel") or tool
	local found = 0
	for _, name in BowAssembly.MeshNames do
		local part = findPart(folder, name)
		local info = (Layout.Parts :: any)[name]
		if part and info then
			found += 1
			for _, old in part:GetChildren() do
				if old:IsA("JointInstance") or old:IsA("WeldConstraint") then
					old:Destroy()
				end
			end
			quiet(part)
			part.Size = info.Size * scale
			weld(handle, part, CFrame.new(info.Center * scale))
			style(name, part)
			part.Name = name
		end
	end
	if found == 0 then
		if Config.ShowPlaceholderIfMeshesMissing then
			warn("[LunarBow] Meshes not found in the Tool; using a placeholder. See README (Importar el modelo).")
			buildPlaceholder(handle, folder, scale)
		end
	elseif found < #BowAssembly.MeshNames then
		warn(("[LunarBow] Only %d/%d bow meshes were found in the Tool."):format(found, #BowAssembly.MeshNames))
	end

	-- named points
	local pts: { [string]: Attachment } = {}
	for name, pos in Layout.Points :: { [string]: Vector3 } do
		pts[name] = attachment(handle, name, pos * scale)
	end
	local nock = attachment(handle, "StringNock", Layout.Points.StringRest * scale)

	-- string: a crisp core + a soft halo
	beam("StringUpper", pts.StringTop, nock, 0.045 * scale, 0)
	beam("StringLower", nock, pts.StringBottom, 0.045 * scale, 0)
	beam("StringGlowUpper", pts.StringTop, nock, 0.3 * scale, 0.82)
	beam("StringGlowLower", nock, pts.StringBottom, 0.3 * scale, 0.82)

	local light = Instance.new("PointLight")
	light.Name = "CoreLight"
	light.Color = Config.Colors.Glow
	light.Range = 8 * scale
	light.Brightness = 1.2
	light.Shadows = false
	light.Parent = pts.CoreLight

	-- drifting motes around the limbs
	local motesHost: Instance = findPart(folder, "Limbs") or handle
	local motes = Instance.new("ParticleEmitter")
	motes.Name = "Motes"
	motes.Texture = BowAssembly.SparkleTexture
	motes.Rate = 6
	motes.Lifetime = NumberRange.new(0.8, 1.6)
	motes.Speed = NumberRange.new(0.2, 0.6)
	motes.SpreadAngle = Vector2.new(180, 180)
	motes.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.2 * scale),
		NumberSequenceKeypoint.new(1, 0),
	})
	motes.Transparency = NumberSequence.new(0.1, 1)
	motes.LightEmission = 1
	motes.LightInfluence = 0
	motes.Color = ColorSequence.new(Config.Colors.Glow)
	motes.Rotation = NumberRange.new(0, 360)
	motes.RotSpeed = NumberRange.new(-90, 90)
	motes.Parent = motesHost

	-- burst used by summon / release / dismiss
	local burst = Instance.new("ParticleEmitter")
	burst.Name = "Burst"
	burst.Texture = BowAssembly.SparkleTexture
	burst.Enabled = false
	burst.Lifetime = NumberRange.new(0.3, 0.7)
	burst.Speed = NumberRange.new(5, 12)
	burst.SpreadAngle = Vector2.new(180, 180)
	burst.Drag = 4
	burst.Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.45 * scale),
		NumberSequenceKeypoint.new(1, 0),
	})
	burst.Transparency = NumberSequence.new(0, 1)
	burst.LightEmission = 1
	burst.Color = ColorSequence.new(Config.Colors.Charged, Config.Colors.Glow)
	burst.Parent = pts.CoreLight

	trail("TrailTop", pts.TipTopA, pts.TipTopB)
	trail("TrailBottom", pts.TipBottomA, pts.TipBottomB)

	tool.RequiresHandle = false
	tool.CanBeDropped = false
	tool:SetAttribute("Hooked", false)
	tool:SetAttribute("DrawStart", 0)
	tool:SetAttribute("LunarBowAssembled", true)
	CollectionService:AddTag(tool, BowAssembly.Tag)
	return handle
end

-- Motor6D that puts the bow in the left hand. Its Part1 is named "BowHandle",
-- which is what the animations key to spin/tilt the bow.
function BowAssembly.attachToHand(tool: Tool, character: Model): Motor6D?
	local handle = tool:FindFirstChild("BowHandle")
	local hand = character:FindFirstChild("LeftHand")
	if not (handle and handle:IsA("BasePart") and hand and hand:IsA("BasePart")) then
		warn("[LunarBow] The Lunar Bow needs an R15 character (LeftHand not found).")
		return nil
	end
	local old = handle:FindFirstChild("BowGrip")
	if old then
		old:Destroy()
	end
	local gripPos = Vector3.new(0, -0.1, 0)
	local gripAtt = hand:FindFirstChild("LeftGripAttachment")
	if gripAtt and gripAtt:IsA("Attachment") then
		gripPos = Vector3.new(0, gripAtt.Position.Y * 0.67, 0)
	end
	local motor = Instance.new("Motor6D")
	motor.Name = "BowGrip"
	motor.Part0 = hand
	motor.Part1 = handle
	-- bow +Y (upper tip) = hand -Z, bow +Z (string) = hand +Y
	motor.C0 = CFrame.new(gripPos) * CFrame.Angles(-math.pi / 2, 0, 0)
	motor.C1 = CFrame.identity
	motor.Parent = handle
	return motor
end

return BowAssembly
