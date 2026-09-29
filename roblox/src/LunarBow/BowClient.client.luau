--!strict
-- Lunar Bow — local controls (lives inside the Tool).
--
--   Hold click / tap / R2 : draw (the longer you hold at full draw, the stronger)
--   Release               : shoot (charged shot after Config.ChargeTime)
--   Q / ButtonY / button  : "Salto Lunar" special (backflip + triple aerial shot)

local ContextActionService = game:GetService("ContextActionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local tool = script.Parent :: Tool
local player = Players.LocalPlayer
local Shared = ReplicatedStorage:WaitForChild("LunarBowShared")
local Config = require(Shared:WaitForChild("Config"))
local BowAnimator = require(Shared:WaitForChild("BowAnimator"))
local BowVFX = require(Shared:WaitForChild("BowVFX"))
local remote = tool:WaitForChild("BowRemote") :: RemoteEvent

type State = "Off" | "Equipping" | "Idle" | "Drawing" | "Aiming" | "Shooting" | "Special"
type Disconnectable = { Disconnect: (self: any) -> () }

local SPECIAL_ACTION = "LunarBowSpecial"
-- fallback timings (seconds) in case an animation has no markers
local TIMING = {
	Summon = 0.14,
	EquipDone = 0.8,
	Nock = 0.13,
	FullDraw = 0.45,
	Jump = 0.22,
	SpecialDraw = 0.62,
	SpecialRelease = 0.84,
	Land = 1.08,
	SpecialEnd = 1.62,
}

local state: State = "Off"
local anim: BowAnimator.BowAnimator? = nil
local humanoid: Humanoid? = nil
local root: BasePart? = nil
local connections: { Disconnectable } = {}
local actionId = 0
local fired: { [string]: boolean } = {}
local equipAt = 0
local fullDrawAt = 0
local releaseQueued = false
local lastShot = 0
local lastSpecial = -math.huge
local lastHandleCF = CFrame.identity
local baseWalkSpeed = 16
local defaultFov = 70
local aiming = false
local stanceOn = false
local align: AlignOrientation? = nil
local leapConn: RBXScriptConnection? = nil
local leapVelocity: LinearVelocity? = nil
local hud: ScreenGui? = nil
local equipCount = 0

local function now(): number
	return os.clock()
end

-- read through a function so closures never see a stale narrowed type
local function currentState(): State
	return state
end

local function camera(): Camera
	return Workspace.CurrentCamera :: Camera
end

local function tween(inst: Instance, t: number, props: { [string]: any })
	TweenService:Create(inst, TweenInfo.new(t, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), props):Play()
end

-- run `fn` once per action, from whichever arrives first: marker or timer
local function trigger(name: string, fn: () -> ())
	if fired[name] then
		return
	end
	fired[name] = true
	fn()
end

local function newAction(): number
	actionId += 1
	table.clear(fired)
	return actionId
end

local function after(id: number, t: number, name: string, fn: () -> ())
	task.delay(t, function()
		if actionId == id then
			trigger(name, fn)
		end
	end)
end

-- ---------------------------------------------------------------------------
-- aiming helpers
-- ---------------------------------------------------------------------------
local function usesScreenCenter(): boolean
	local last = UserInputService:GetLastInputType()
	if last == Enum.UserInputType.Touch or last.Name:find("Gamepad") then
		return true
	end
	return UserInputService.MouseBehavior == Enum.MouseBehavior.LockCenter
end

local function aimScreenPoint(): Vector2
	if usesScreenCenter() then
		return camera().ViewportSize / 2
	end
	return UserInputService:GetMouseLocation()
end

local function aimTarget(): Vector3
	local p = aimScreenPoint()
	local ray = camera():ViewportPointToRay(p.X, p.Y)
	local result = Workspace:Raycast(ray.Origin, ray.Direction * (Config.Range + 60), BowVFX.raycastParams())
	return if result then result.Position else ray.Origin + ray.Direction * Config.Range
end

local function arrowOrigin(): Vector3
	local handle = tool:FindFirstChild("BowHandle")
	local rest = handle and handle:FindFirstChild("ArrowRest")
	if rest and rest:IsA("Attachment") then
		return rest.WorldPosition
	end
	return if root then root.Position else Vector3.zero
end

local function predictHit(origin: Vector3, target: Vector3): (Vector3, Vector3)
	local delta = target - origin
	if delta.Magnitude < 0.01 then
		return target, Vector3.yAxis
	end
	local dir = delta.Unit
	local result = Workspace:Raycast(origin, dir * Config.Range, BowVFX.raycastParams())
	if result then
		return result.Position, result.Normal
	end
	return origin + dir * Config.Range, -dir
end

local function setHooked(hooked: boolean)
	if tool:GetAttribute("Hooked") == hooked then
		return
	end
	tool:SetAttribute("Hooked", hooked)
	tool:SetAttribute("DrawStart", if hooked then Workspace:GetServerTimeNow() else 0)
	remote:FireServer("Hook", hooked)
end

local function setFacing(point: Vector3?)
	if not root then
		return
	end
	if not point then
		if align then
			align:Destroy()
			align = nil
		end
		return
	end
	local pos = root.Position
	local flat = Vector3.new(point.X - pos.X, 0, point.Z - pos.Z)
	if flat.Magnitude < 0.2 then
		return
	end
	if not align then
		local att = root:FindFirstChild("RootAttachment") :: Attachment?
		if not att then
			local a = Instance.new("Attachment")
			a.Name = "RootAttachment"
			a.Parent = root
			att = a
		end
		local ao = Instance.new("AlignOrientation")
		ao.Name = "LunarBowFacing"
		ao.Mode = Enum.OrientationAlignmentMode.OneAttachment
		ao.Attachment0 = att
		ao.MaxTorque = math.huge
		ao.Responsiveness = 45
		ao.Parent = root
		align = ao
	end
	(align :: AlignOrientation).CFrame = CFrame.lookAt(Vector3.zero, flat.Unit)
end

local function setAiming(on: boolean)
	if aiming == on then
		return
	end
	aiming = on
	if humanoid then
		humanoid.AutoRotate = not on
		humanoid.WalkSpeed = if on then baseWalkSpeed * Config.AimWalkSpeedMultiplier else baseWalkSpeed
		tween(humanoid, 0.25, { CameraOffset = if on then Config.AimCameraOffset else Vector3.zero })
	end
	tween(camera(), 0.25, { FieldOfView = if on then Config.AimFieldOfView else defaultFov })
	if not on then
		setFacing(nil)
		if stanceOn and anim then
			anim:Stop("AimStance", 0.2)
		end
		stanceOn = false
	end
end

-- ---------------------------------------------------------------------------
-- HUD (crosshair + charge bar + special cooldown)
-- ---------------------------------------------------------------------------
local function buildHud(): ScreenGui
	local gui = Instance.new("ScreenGui")
	gui.Name = "LunarBowHUD"
	gui.ResetOnSpawn = true
	gui.IgnoreGuiInset = true
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	local cross = Instance.new("Frame")
	cross.Name = "Crosshair"
	cross.AnchorPoint = Vector2.new(0.5, 0.5)
	cross.Size = UDim2.fromOffset(64, 64)
	cross.BackgroundTransparency = 1
	cross.Parent = gui
	for i, rot in { 0, 90, 180, 270 } do
		local tick = Instance.new("Frame")
		tick.Name = "Tick" .. i
		tick.AnchorPoint = Vector2.new(0.5, 0.5)
		tick.Size = UDim2.fromOffset(2, 9)
		tick.BorderSizePixel = 0
		tick.BackgroundColor3 = Config.Colors.Glow
		tick.Rotation = rot
		tick.Parent = cross
	end
	local dot = Instance.new("Frame")
	dot.Name = "Dot"
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Position = UDim2.fromScale(0.5, 0.5)
	dot.Size = UDim2.fromOffset(5, 5)
	dot.Rotation = 45
	dot.BorderSizePixel = 0
	dot.BackgroundColor3 = Color3.new(1, 1, 1)
	dot.Parent = cross

	local bar = Instance.new("Frame")
	bar.Name = "Charge"
	bar.AnchorPoint = Vector2.new(0.5, 0)
	bar.Position = UDim2.new(0.5, 0, 1, 2)
	bar.Size = UDim2.fromOffset(56, 4)
	bar.BackgroundColor3 = Color3.fromRGB(10, 20, 40)
	bar.BackgroundTransparency = 0.3
	bar.BorderSizePixel = 0
	bar.Visible = false
	bar.Parent = cross
	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.Size = UDim2.fromScale(0, 1)
	fill.BorderSizePixel = 0
	fill.BackgroundColor3 = Config.Colors.Glow
	fill.Parent = bar
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = bar

	local label = Instance.new("TextLabel")
	label.Name = "Special"
	label.AnchorPoint = Vector2.new(0.5, 1)
	label.Position = UDim2.new(0.5, 0, 1, -110)
	label.Size = UDim2.fromOffset(260, 26)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = 16
	label.TextColor3 = Config.Colors.Glow
	label.TextStrokeTransparency = 0.5
	label.Text = ""
	label.Parent = gui

	gui.Parent = player:WaitForChild("PlayerGui")
	return gui
end

local function updateHud()
	if not hud then
		return
	end
	local cross = hud:FindFirstChild("Crosshair") :: Frame?
	if not cross then
		return
	end
	local p = aimScreenPoint()
	cross.Position = UDim2.fromOffset(p.X, p.Y)

	local charge = 0
	if state == "Aiming" then
		charge = math.clamp((now() - fullDrawAt) / Config.ChargeTime, 0, 1)
	end
	local drawing = state == "Drawing" or state == "Aiming"
	local spread = if drawing then 14 - 9 * charge else 16
	for i, dir in { Vector2.new(0, -1), Vector2.new(1, 0), Vector2.new(0, 1), Vector2.new(-1, 0) } do
		local tick = cross:FindFirstChild("Tick" .. i) :: Frame?
		if tick then
			tick.Position = UDim2.new(0.5, dir.X * spread, 0.5, dir.Y * spread)
			tick.BackgroundColor3 = if charge >= 1 then Config.Colors.Charged else Config.Colors.Glow
		end
	end
	local bar = cross:FindFirstChild("Charge") :: Frame?
	if bar then
		bar.Visible = drawing
		local fill = bar:FindFirstChild("Fill") :: Frame?
		if fill then
			fill.Size = UDim2.fromScale(charge, 1)
			fill.BackgroundColor3 = if charge >= 1
				then Config.Colors.Charged:Lerp(Color3.new(1, 1, 1), 0.5 + 0.5 * math.sin(now() * 16))
				else Config.Colors.Glow
		end
	end
	local label = hud:FindFirstChild("Special") :: TextLabel?
	if label then
		local left = Config.SpecialCooldown - (now() - lastSpecial)
		label.Text = if left > 0
			then ("Salto Lunar  %.1fs"):format(left)
			else "[" .. Config.SpecialKeys[1].Name .. "]  Salto Lunar"
		label.TextTransparency = if left > 0 then 0.5 else 0
	end
end

-- ---------------------------------------------------------------------------
-- shooting
-- ---------------------------------------------------------------------------
local function fire()
	if state ~= "Aiming" or not anim then
		return
	end
	local charged = now() - fullDrawAt >= Config.ChargeTime
	local kind = if charged then "charged" else "normal"
	newAction()
	state = "Shooting"
	lastShot = now()
	anim:Stop("Aim", 0.05)
	anim:Stop("Draw", 0.05)
	anim:Play(if charged then "ShootCharged" else "Shoot", 0.03)
	setHooked(false)

	local origin = arrowOrigin()
	local target = aimTarget()
	local hit, normal = predictHit(origin, target)
	BowVFX.fireArrow(origin, hit, kind, normal)
	BowVFX.burst(tool, if charged then 34 else 12)
	remote:FireServer("Fire", kind, origin, { target })
	if charged then
		local cam = camera()
		cam.FieldOfView = Config.AimFieldOfView + 6
		tween(cam, 0.3, { FieldOfView = Config.AimFieldOfView })
	end

	local id = actionId
	task.delay(if charged then 0.45 else 0.3, function()
		if actionId == id and currentState() == "Shooting" then
			state = "Idle"
			setAiming(false)
		end
	end)
end

local function enterAim()
	if state ~= "Drawing" or not anim then
		return
	end
	state = "Aiming"
	fullDrawAt = now()
	setHooked(true)
	anim:Play("Aim", 0.12)
	if releaseQueued then
		fire()
	end
end

local function beginDraw()
	if not anim then
		return
	end
	local ready = state == "Idle"
		or (state == "Equipping" and now() - equipAt > 0.5)
		or (state == "Shooting" and now() - lastShot > Config.FireCooldown)
	if not ready then
		return
	end
	local id = newAction()
	state = "Drawing"
	releaseQueued = false
	anim:Stop("Equip", 0.12)
	anim:Stop("Shoot", 0.12)
	anim:Stop("ShootCharged", 0.12)
	anim:Play("Draw", 0.08)
	setAiming(true)
	after(id, TIMING.Nock, "Nock", function()
		setHooked(true)
	end)
	after(id, TIMING.FullDraw + 0.03, "FullDraw", enterAim)
end

local function onDeactivated()
	if state == "Drawing" then
		releaseQueued = true
	elseif state == "Aiming" then
		fire()
	end
end

-- ---------------------------------------------------------------------------
-- special: "Salto Lunar"
-- ---------------------------------------------------------------------------
local function endLeap()
	if leapConn then
		leapConn:Disconnect()
		leapConn = nil
	end
	if leapVelocity then
		leapVelocity:Destroy()
		leapVelocity = nil
		if root then
			local v = root.AssemblyLinearVelocity
			root.AssemblyLinearVelocity = Vector3.new(0, math.min(v.Y, 0), 0)
		end
	end
end

local function startLeap()
	if not root then
		return
	end
	endLeap()
	local att = root:FindFirstChild("RootAttachment") :: Attachment?
	if not att then
		local a = Instance.new("Attachment")
		a.Name = "RootAttachment"
		a.Parent = root
		att = a
	end
	local airTime = TIMING.Land - TIMING.Jump
	local h = Config.SpecialJumpHeight
	local v0 = 4 * h / airTime
	local g = 8 * h / (airTime * airTime)
	local look = root.CFrame.LookVector
	local flat = Vector3.new(look.X, 0, look.Z)
	local back = if flat.Magnitude > 0.01 then -flat.Unit * (Config.SpecialJumpBack / airTime) else Vector3.zero

	local lv = Instance.new("LinearVelocity")
	lv.Name = "LunarBowLeap"
	lv.Attachment0 = att :: Attachment
	lv.VelocityConstraintMode = Enum.VelocityConstraintMode.Vector
	lv.RelativeTo = Enum.ActuatorRelativeTo.World
	lv.MaxForce = 1e6
	lv.VectorVelocity = back + Vector3.new(0, v0, 0)
	lv.Parent = root
	leapVelocity = lv
	local t0 = now()
	leapConn = RunService.Heartbeat:Connect(function()
		local t = now() - t0
		lv.VectorVelocity = back + Vector3.new(0, v0 - g * t, 0)
		if t > airTime + 0.3 then
			endLeap()
		end
	end)
end

local function specialVolley()
	local origin = arrowOrigin()
	local target = aimTarget()
	local base = target - origin
	if base.Magnitude < 1 then
		return
	end
	local targets = {}
	local n = Config.SpecialArrows
	for i = 1, n do
		local yaw = math.rad((i - (n + 1) / 2) * Config.SpecialSpread)
		local dir = CFrame.fromAxisAngle(Vector3.yAxis, yaw):VectorToWorldSpace(base)
		local t = origin + dir
		table.insert(targets, t)
		local hit, normal = predictHit(origin, t)
		BowVFX.fireArrow(origin, hit, "special", normal)
	end
	BowVFX.burst(tool, 40)
	remote:FireServer("Fire", "special", origin, targets)
end

local function finishSpecial(id: number)
	if actionId ~= id or state ~= "Special" then
		return
	end
	endLeap()
	setHooked(false)
	BowVFX.setTrails(tool, false)
	setFacing(nil)
	if humanoid then
		humanoid.AutoRotate = true
	end
	state = "Idle"
end

local function special()
	if not (anim and humanoid and root) then
		return
	end
	if not (state == "Idle" or state == "Drawing" or state == "Aiming" or state == "Equipping") then
		return
	end
	if now() - lastSpecial < Config.SpecialCooldown or humanoid.FloorMaterial == Enum.Material.Air then
		return
	end
	lastSpecial = now()
	local id = newAction()
	state = "Special"
	anim:StopAll(0.08, { Hold = true })
	setHooked(false)
	setAiming(false)
	humanoid.AutoRotate = false
	setFacing(aimTarget())
	BowVFX.setTrails(tool, true)
	anim:Play("Special", 0.05)

	after(id, TIMING.Jump, "Jump", startLeap)
	after(id, TIMING.SpecialDraw, "SpecialDraw", function()
		setHooked(true)
	end)
	after(id, TIMING.SpecialRelease, "SpecialRelease", function()
		setHooked(false)
		specialVolley()
	end)
	after(id, TIMING.Land, "Land", function()
		endLeap()
		if root and humanoid then
			local foot = root.Position - Vector3.new(0, humanoid.HipHeight + root.Size.Y / 2, 0)
			BowVFX.landing(foot)
			remote:FireServer("Land", foot)
		end
	end)
	task.delay(TIMING.SpecialEnd, finishSpecial, id)
end

-- ---------------------------------------------------------------------------
-- equip / unequip
-- ---------------------------------------------------------------------------
local function track(c: Disconnectable)
	table.insert(connections, c)
end

local function wireMarkers(a: BowAnimator.BowAnimator)
	-- markers make the timing follow the animation exactly (also with AdjustSpeed);
	-- the timers in TIMING are only a fallback.
	local equipNumber = equipCount
	local summoned = false
	local function summon()
		if not summoned and equipCount == equipNumber then
			summoned = true
			BowVFX.summon(tool)
		end
	end
	track(a:Get("Equip"):OnMarker("Summon", summon))
	task.delay(TIMING.Summon + 0.05, summon)
	track(a:Get("Draw"):OnMarker("Nock", function()
		if state == "Drawing" then
			trigger("Nock", function()
				setHooked(true)
			end)
		end
	end))
	track(a:Get("Draw"):OnMarker("FullDraw", function()
		if state == "Drawing" then
			trigger("FullDraw", enterAim)
		end
	end))
	local sp = a:Get("Special")
	track(sp:OnMarker("Jump", function()
		trigger("Jump", startLeap)
	end))
	track(sp:OnMarker("Draw", function()
		trigger("SpecialDraw", function()
			setHooked(true)
		end)
	end))
	track(sp:OnMarker("Release", function()
		trigger("SpecialRelease", function()
			setHooked(false)
			specialVolley()
		end)
	end))
end

local function cleanup()
	for _, c in connections do
		c:Disconnect()
	end
	table.clear(connections)
	ContextActionService:UnbindAction(SPECIAL_ACTION)
	endLeap()
	setAiming(false)
	setFacing(nil)
	if humanoid then
		humanoid.AutoRotate = true
	end
	if hud then
		hud:Destroy()
		hud = nil
	end
	UserInputService.MouseIconEnabled = true
	if tool:GetAttribute("Hooked") then
		setHooked(false)
	end
end

local function onEquipped()
	local char = tool.Parent
	if not (char and char:IsA("Model")) then
		return
	end
	local hum = char:FindFirstChildOfClass("Humanoid")
	local hrp = char:FindFirstChild("HumanoidRootPart")
	if not (hum and hrp and hrp:IsA("BasePart")) then
		return
	end
	if hum.RigType ~= Enum.HumanoidRigType.R15 then
		warn("[LunarBow] This bow and its animations are made for R15 characters.")
	end
	humanoid, root = hum, hrp
	baseWalkSpeed = hum.WalkSpeed
	defaultFov = camera().FieldOfView

	local a = BowAnimator.new(char, function(name: string, op: string, fade: number?, speed: number?)
		if name ~= "Hold" then -- every client plays Hold by itself
			remote:FireServer("Anim", name, op, fade, speed)
		end
	end)
	anim = a
	equipCount += 1
	wireMarkers(a)

	local id = newAction()
	state = "Equipping"
	equipAt = now()
	BowVFX.hideBow(tool)
	a:Play("Hold", 0.3)
	a:Play("Equip", 0.08)
	task.delay(TIMING.EquipDone, function()
		if actionId == id and state == "Equipping" then
			state = "Idle"
		end
	end)

	hud = buildHud()
	if UserInputService.MouseEnabled then
		UserInputService.MouseIconEnabled = false
	end
	ContextActionService:BindAction(SPECIAL_ACTION, function(_, inputState)
		if inputState == Enum.UserInputState.Begin then
			special()
		end
		return Enum.ContextActionResult.Sink
	end, true, table.unpack(Config.SpecialKeys))
	ContextActionService:SetTitle(SPECIAL_ACTION, "Salto")
	ContextActionService:SetPosition(SPECIAL_ACTION, UDim2.new(1, -180, 1, -130))

	track(hum.Died:Connect(cleanup) :: any)
	track(RunService.RenderStepped:Connect(function()
		local handle = tool:FindFirstChild("BowHandle")
		if handle and handle:IsA("BasePart") then
			lastHandleCF = handle.CFrame
		end
		if (state == "Drawing" or state == "Aiming" or state == "Shooting") and aiming then
			setFacing(aimTarget())
			local still = hum.MoveDirection.Magnitude < 0.1 and hum.FloorMaterial ~= Enum.Material.Air
			local want = still and state ~= "Shooting"
			if want ~= stanceOn then
				stanceOn = want
				if want then
					a:Play("AimStance", 0.25)
				else
					a:Stop("AimStance", 0.2)
				end
			end
		end
		updateHud()
	end) :: any)
end

local function onUnequipped()
	newAction()
	state = "Off"
	cleanup()
	if anim then
		anim:StopAll(0.12)
		anim:Play("Unequip", 0.08)
		local old = anim
		anim = nil
		task.delay(1, function()
			if anim ~= old then
				old:Destroy()
			end
		end)
	end
	BowVFX.dismiss(tool, lastHandleCF)
	remote:FireServer("Dismiss", lastHandleCF)
	humanoid, root = nil, nil
end

tool.Equipped:Connect(onEquipped)
tool.Unequipped:Connect(onUnequipped)
tool.Activated:Connect(beginDraw)
tool.Deactivated:Connect(onDeactivated)
