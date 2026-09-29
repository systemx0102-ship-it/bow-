--!strict
-- Client-side visuals for the Lunar Bow: the living string, the nocked arrow,
-- aura/charge glow, projectiles, impacts, summon and dismiss effects.
-- Everything here is cosmetic and runs on every client.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")
local Debris = game:GetService("Debris")

local Config = require(script.Parent.Config)
local Layout = require(script.Parent.BowLayout)

local BowVFX = {}

local SPARKLE = "rbxasset://textures/particles/sparkles_main.dds"
local BOW_PARTS = { "Limbs", "Armor", "Grip", "Crystals", "Aura" }

local folder: Folder? = nil
function BowVFX.effectsFolder(): Folder
	if folder and folder.Parent then
		return folder
	end
	local f = Workspace:FindFirstChild("LunarBowEffects")
	if not (f and f:IsA("Folder")) then
		local nf = Instance.new("Folder")
		nf.Name = "LunarBowEffects"
		nf.Parent = Workspace
		f = nf
	end
	folder = f :: Folder
	return f :: Folder
end

local function tween(inst: Instance, t: number, props: { [string]: any }, style: Enum.EasingStyle?, dir: Enum.EasingDirection?)
	local tw = TweenService:Create(inst, TweenInfo.new(t, style or Enum.EasingStyle.Quad, dir or Enum.EasingDirection.Out), props)
	tw:Play()
	return tw
end

local function fxPart(shape: Enum.PartType?): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.Neon
	p.Color = Config.Colors.Glow
	if shape then
		p.Shape = shape
	end
	return p
end

local function sparkleEmitter(parent: Instance, size: number, speed: number, color: Color3?): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.Texture = SPARKLE
	e.Enabled = false
	e.Lifetime = NumberRange.new(0.25, 0.6)
	e.Speed = NumberRange.new(speed * 0.5, speed)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Drag = 5
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, size), NumberSequenceKeypoint.new(1, 0) })
	e.Transparency = NumberSequence.new(0, 1)
	e.LightEmission = 1
	e.LightInfluence = 0
	e.Rotation = NumberRange.new(0, 360)
	e.Color = ColorSequence.new(color or Config.Colors.Charged, Config.Colors.Glow)
	e.Parent = parent
	return e
end

-- ---------------------------------------------------------------------------
-- arrows
-- ---------------------------------------------------------------------------
local KIND_SCALE: { [string]: number } = { normal = 1, charged = 1.45, special = 1.1 }

function BowVFX.makeArrow(kind: string): BasePart
	local s = Config.BowScale * (KIND_SCALE[kind] or 1)
	local assets = ReplicatedStorage:FindFirstChild("LunarBowShared")
	assets = assets and assets:FindFirstChild("Assets")
	local template = assets and assets:FindFirstChild("LunarArrow")
	local arrow: BasePart
	if template and template:IsA("BasePart") then
		arrow = template:Clone()
		arrow.Size = Layout.Parts.LunarArrow.Size * s
	else
		arrow = fxPart()
		arrow.Size = Vector3.new(0.07, 0.07, Layout.ArrowLength) * s
	end
	arrow.Name = "LunarArrow"
	arrow.Anchored = true
	arrow.CanCollide = false
	arrow.CanQuery = false
	arrow.CanTouch = false
	arrow.CastShadow = false
	arrow.Material = Enum.Material.Neon
	arrow.Color = if kind == "charged" then Config.Colors.Charged else Config.Colors.Glow
	arrow:SetAttribute("Scale", s)
	return arrow
end

-- CFrame for an arrow whose tail sits at `tail` and flies toward `dir`.
function BowVFX.arrowCFrame(arrow: BasePart, tail: Vector3, dir: Vector3): CFrame
	local s = (arrow:GetAttribute("Scale") :: number?) or 1
	local center = Layout.Parts.LunarArrow.Center * s
	return CFrame.lookAt(tail, tail + dir) * CFrame.new(center)
end

local function addArrowTrail(arrow: BasePart, kind: string)
	local s = (arrow:GetAttribute("Scale") :: number?) or 1
	local a0 = Instance.new("Attachment")
	a0.Position = Vector3.new(0, 0.07 * s, -Layout.ArrowTailOffset * s)
	a0.Parent = arrow
	local a1 = Instance.new("Attachment")
	a1.Position = Vector3.new(0, -0.07 * s, -Layout.ArrowTailOffset * s)
	a1.Parent = arrow
	local t = Instance.new("Trail")
	t.Attachment0 = a0
	t.Attachment1 = a1
	t.Lifetime = if kind == "charged" then 0.35 else 0.2
	t.LightEmission = 1
	t.LightInfluence = 0
	t.FaceCamera = true
	t.Color = ColorSequence.new(Config.Colors.Charged, Config.Colors.GlowDeep)
	t.Transparency = NumberSequence.new(0.1, 1)
	t.WidthScale = NumberSequence.new(if kind == "charged" then 2.5 else 1.2, 0)
	t.Parent = arrow
	local light = Instance.new("PointLight")
	light.Color = Config.Colors.Glow
	light.Range = if kind == "charged" then 12 else 7
	light.Brightness = 2
	light.Parent = arrow
	if kind == "charged" then
		local e = sparkleEmitter(a0, 0.35 * s, 2)
		e.Enabled = true
		e.Rate = 60
		e.Lifetime = NumberRange.new(0.2, 0.4)
	end
end

function BowVFX.impact(position: Vector3, normal: Vector3, kind: string)
	local big = kind == "charged"
	local root = fxPart()
	root.Transparency = 1
	root.Size = Vector3.one * 0.1
	root.CFrame = CFrame.new(position)
	root.Parent = BowVFX.effectsFolder()
	local att = Instance.new("Attachment")
	att.Parent = root
	local e = sparkleEmitter(att, if big then 0.8 else 0.45, if big then 26 else 14)
	e:Emit(if big then 60 else 26)
	local light = Instance.new("PointLight")
	light.Color = Config.Colors.Glow
	light.Range = if big then 20 else 10
	light.Brightness = 4
	light.Parent = root
	tween(light, 0.45, { Brightness = 0 })

	-- shockwave disc aligned with the surface
	local ring = fxPart(Enum.PartType.Cylinder)
	ring.Transparency = 0.1
	ring.Size = Vector3.new(0.08, 0.4, 0.4)
	ring.CFrame = CFrame.lookAt(position, position + normal) * CFrame.Angles(0, math.rad(90), 0)
	ring.Parent = root
	local r = if big then 11 else 5
	tween(ring, if big then 0.45 else 0.3, { Size = Vector3.new(0.04, r, r), Transparency = 1 })

	local flash = fxPart(Enum.PartType.Ball)
	flash.Color = Config.Colors.Charged
	flash.Size = Vector3.one * (if big then 1.2 else 0.6)
	flash.CFrame = CFrame.new(position)
	flash.Parent = root
	tween(flash, 0.25, { Size = Vector3.one * (if big then 4.5 else 2.2), Transparency = 1 })
	Debris:AddItem(root, 1.2)
end

-- Visual projectile from `origin` to `target`; calls impact at the end.
function BowVFX.fireArrow(origin: Vector3, target: Vector3, kind: string, hitNormal: Vector3?)
	local delta = target - origin
	local dist = delta.Magnitude
	if dist < 0.1 then
		return
	end
	local dir = delta / dist
	local speed = (Config.ArrowSpeed :: { [string]: number })[kind] or 300
	local arrow = BowVFX.makeArrow(kind)
	arrow.CFrame = BowVFX.arrowCFrame(arrow, origin, dir)
	arrow.Parent = BowVFX.effectsFolder()
	addArrowTrail(arrow, kind)
	local traveled = 0
	local conn: RBXScriptConnection
	conn = RunService.Heartbeat:Connect(function(dt: number)
		traveled = math.min(dist, traveled + speed * dt)
		arrow.CFrame = BowVFX.arrowCFrame(arrow, origin + dir * traveled, dir)
		if traveled >= dist then
			conn:Disconnect()
			arrow.Transparency = 1
			for _, d in arrow:GetDescendants() do
				if d:IsA("ParticleEmitter") then
					d.Enabled = false
				end
			end
			Debris:AddItem(arrow, 0.5)
			BowVFX.impact(target, hitNormal or -dir, kind)
		end
	end)
end

-- ---------------------------------------------------------------------------
-- bow helpers
-- ---------------------------------------------------------------------------
local function bowParts(tool: Instance): { BasePart }
	local out = {}
	for _, d in tool:GetDescendants() do
		if d:IsA("BasePart") and d.Name ~= "BowHandle" then
			table.insert(out, d)
		end
	end
	return out
end

function BowVFX.setTrails(tool: Instance, enabled: boolean)
	for _, d in tool:GetDescendants() do
		if d:IsA("Trail") then
			d.Enabled = enabled
		end
	end
end

function BowVFX.burst(tool: Instance, count: number)
	local handle = tool:FindFirstChild("BowHandle")
	local core = handle and handle:FindFirstChild("CoreLight")
	local e = core and core:FindFirstChild("Burst")
	if e and e:IsA("ParticleEmitter") then
		e:Emit(count)
	end
end

function BowVFX.hideBow(tool: Instance)
	for _, p in bowParts(tool) do
		p.LocalTransparencyModifier = 1
	end
end

-- "Summon": the bow condenses out of moonlight.
function BowVFX.summon(tool: Instance)
	local parts = bowParts(tool)
	local t0 = os.clock()
	local conn: RBXScriptConnection
	conn = RunService.RenderStepped:Connect(function()
		local a = math.clamp((os.clock() - t0) / 0.35, 0, 1)
		for _, p in parts do
			if p.Parent then
				p.LocalTransparencyModifier = 1 - a * a
			end
		end
		if a >= 1 then
			conn:Disconnect()
		end
	end)
	BowVFX.burst(tool, 40)
	BowVFX.setTrails(tool, true)
	task.delay(0.9, function()
		if tool.Parent then
			BowVFX.setTrails(tool, false)
		end
	end)
end

-- "Dismiss": a ghost of the bow floats up and dissolves (tool may already be in the Backpack).
function BowVFX.dismiss(tool: Instance?, handleCFrame: CFrame)
	local root = fxPart()
	root.Transparency = 1
	root.Size = Vector3.one * 0.1
	root.CFrame = handleCFrame
	root.Parent = BowVFX.effectsFolder()
	local att = Instance.new("Attachment")
	att.Parent = root
	sparkleEmitter(att, 0.4, 8):Emit(45)
	if tool then
		local handle = tool:FindFirstChild("BowHandle")
		for _, name in BOW_PARTS do
			local src = tool:FindFirstChild(name, true)
			local w = src and src:FindFirstChild("BowWeld")
			if src and src:IsA("BasePart") and w and w:IsA("Weld") and handle then
				local ghost = src:Clone()
				ghost:ClearAllChildren()
				local sa = src:FindFirstChildOfClass("SurfaceAppearance")
				if sa then
					sa:Clone().Parent = ghost
				end
				ghost.Anchored = true
				ghost.LocalTransparencyModifier = 0
				ghost.CFrame = handleCFrame * w.C0
				ghost.Parent = root
				tween(ghost, 0.55, {
					CFrame = ghost.CFrame + Vector3.new(0, 1.6, 0),
					Transparency = 1,
				}, Enum.EasingStyle.Sine, Enum.EasingDirection.In)
			end
		end
	end
	Debris:AddItem(root, 1)
end

function BowVFX.landing(position: Vector3)
	local ring = fxPart(Enum.PartType.Cylinder)
	ring.Color = Config.Colors.Glow
	ring.Transparency = 0.2
	ring.Size = Vector3.new(0.06, 1, 1)
	ring.CFrame = CFrame.new(position) * CFrame.Angles(0, 0, math.rad(90))
	ring.Parent = BowVFX.effectsFolder()
	tween(ring, 0.4, { Size = Vector3.new(0.03, 12, 12), Transparency = 1 })
	local att = Instance.new("Attachment")
	att.Parent = ring
	sparkleEmitter(att, 0.35, 10):Emit(30)
	Debris:AddItem(ring, 0.8)
end

-- ---------------------------------------------------------------------------
-- per-bow live visuals: string spring, nocked arrow, aura charge
-- ---------------------------------------------------------------------------
type Tracker = { update: (dt: number) -> (), destroy: () -> () }

function BowVFX.trackBow(tool: Tool): Tracker?
	local handle = tool:FindFirstChild("BowHandle")
	if not (handle and handle:IsA("BasePart")) then
		return nil
	end
	local nock = handle:FindFirstChild("StringNock") :: Attachment?
	local rest = handle:FindFirstChild("StringRest") :: Attachment?
	local arrowRest = handle:FindFirstChild("ArrowRest") :: Attachment?
	local coreAtt = handle:FindFirstChild("CoreLight")
	local light = coreAtt and coreAtt:FindFirstChildOfClass("PointLight")
	local aura = tool:FindFirstChild("Aura", true) :: BasePart?
	local crystals = tool:FindFirstChild("Crystals", true) :: BasePart?
	if not (nock and rest and arrowRest) then
		return nil
	end

	local pos = rest.Position
	local vel = Vector3.zero
	local wasHooked = false
	local arrow: BasePart? = nil

	local function update(dt: number)
		dt = math.min(dt, 1 / 30)
		local character = tool.Parent
		local hooked = tool:GetAttribute("Hooked") == true and character ~= nil and character:IsA("Model")
		local target = rest.Position
		if hooked and character then
			local hand = character:FindFirstChild("RightHand")
			if hand and hand:IsA("BasePart") then
				local grip = hand:FindFirstChild("RightGripAttachment")
				local world = if grip and grip:IsA("Attachment")
					then grip.WorldPosition
					else (hand.CFrame * CFrame.new(0, -0.15, 0)).Position
				target = handle.CFrame:PointToObjectSpace(world)
			end
		end
		-- stiff while held, loose & bouncy ("twang") once released
		local k, c = if hooked then 2200 else 950, if hooked then 90 else 13
		if hooked and not wasHooked then
			vel = Vector3.zero
		end
		vel += ((target - pos) * k - vel * c) * dt
		pos += vel * dt
		nock.Position = pos
		wasHooked = hooked

		-- the arrow sits on the string while it is hooked
		if hooked then
			if not arrow then
				local a = BowVFX.makeArrow("normal")
				a.Parent = BowVFX.effectsFolder()
				arrow = a
			end
			local tail = nock.WorldPosition
			local dir = (arrowRest.WorldPosition - tail)
			if dir.Magnitude > 0.05 then
				(arrow :: BasePart).CFrame = BowVFX.arrowCFrame(arrow :: BasePart, tail, dir.Unit)
			end
		elseif arrow then
			arrow:Destroy()
			arrow = nil
		end

		-- charge glow (DrawStart is a server time stamp)
		local charge = 0
		local start = tool:GetAttribute("DrawStart") :: number?
		if hooked and start and start > 0 then
			charge = math.clamp((Workspace:GetServerTimeNow() - start - 0.45) / Config.ChargeTime, 0, 1)
		end
		if aura then
			local target_t = Config.AuraIdleTransparency
				+ (Config.AuraChargedTransparency - Config.AuraIdleTransparency) * charge
			aura.Transparency += (target_t - aura.Transparency) * math.min(1, dt * 10)
		end
		if light then
			light.Brightness = 1.2 + charge * 2.5 + (if charge >= 1 then math.sin(os.clock() * 18) * 0.8 else 0)
		end
		if crystals then
			local pulse = if charge >= 1 then 0.5 + 0.5 * math.sin(os.clock() * 18) else charge * 0.4
			crystals.Color = Config.Colors.Glow:Lerp(Config.Colors.Charged, pulse)
		end
		if arrow then
			arrow.Color = if charge >= 1 then Config.Colors.Charged else Config.Colors.Glow
		end
	end

	local function destroy()
		if arrow then
			arrow:Destroy()
			arrow = nil
		end
	end

	return { update = update, destroy = destroy }
end

-- The local player's character is excluded from aim raycasts together with effects.
function BowVFX.raycastParams(extra: { Instance }?): RaycastParams
	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	local list: { Instance } = { BowVFX.effectsFolder() }
	local lp = Players.LocalPlayer
	if lp and lp.Character then
		table.insert(list, lp.Character)
	end
	if extra then
		for _, i in extra do
			table.insert(list, i)
		end
	end
	params.FilterDescendantsInstances = list
	return params
end

return BowVFX
