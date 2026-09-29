--!strict
-- Lunar Bow — server side (lives inside the Tool).
-- Builds the bow, attaches it to the LEFT hand with a Motor6D, validates shots,
-- applies damage and relays cosmetic events to the other clients.

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local tool = script.Parent :: Tool
local Shared = ReplicatedStorage:WaitForChild("LunarBowShared")
local Config = require(Shared:WaitForChild("Config"))
local BowAssembly = require(Shared:WaitForChild("BowAssembly"))
local AnimationData = require(Shared:WaitForChild("BowAnimationData"))
local FX = Shared:WaitForChild("FX") :: RemoteEvent
local remote = tool:WaitForChild("BowRemote") :: RemoteEvent

BowAssembly.assemble(tool)

local grip: Motor6D? = nil
local lastFire = 0
local lastSpecial = -math.huge
local animBudget = 0
local animBudgetAt = os.clock()

local function ownerOf(): Player?
	local parent = tool.Parent
	if parent and parent:IsA("Backpack") then
		local p = parent.Parent
		return if p and p:IsA("Player") then p else nil
	end
	return if parent then Players:GetPlayerFromCharacter(parent) else nil
end

local function toOthers(except: Player?, ...: any)
	for _, p in Players:GetPlayers() do
		if p ~= except then
			FX:FireClient(p, ...)
		end
	end
end

local function humanoidFrom(inst: Instance): Humanoid?
	local model = inst:FindFirstAncestorOfClass("Model")
	while model do
		local h = model:FindFirstChildOfClass("Humanoid")
		if h then
			return h
		end
		model = model:FindFirstAncestorOfClass("Model")
	end
	return nil
end

local function canDamage(attacker: Player, humanoid: Humanoid): boolean
	if humanoid.Health <= 0 or humanoid.Parent == attacker.Character then
		return false
	end
	local victim = Players:GetPlayerFromCharacter(humanoid.Parent)
	if victim and Config.TeamCheck and not attacker.Neutral and not victim.Neutral and attacker.Team == victim.Team then
		return false
	end
	return true
end

local function damage(attacker: Player, humanoid: Humanoid, amount: number)
	local old = humanoid:FindFirstChild("creator")
	if old then
		old:Destroy()
	end
	local tag = Instance.new("ObjectValue")
	tag.Name = "creator" -- classic kill-credit tag
	tag.Value = attacker
	tag.Parent = humanoid
	Debris:AddItem(tag, 2)
	humanoid:TakeDamage(amount)
end

local function onFire(player: Player, kind: any, origin: any, targets: any)
	if typeof(kind) ~= "string" or typeof(origin) ~= "Vector3" or typeof(targets) ~= "table" then
		return
	end
	if kind ~= "normal" and kind ~= "charged" and kind ~= "special" then
		return
	end
	local character = player.Character
	if not character or tool.Parent ~= character then
		return
	end
	local root = character:FindFirstChild("HumanoidRootPart")
	if not (root and root:IsA("BasePart")) or (origin - root.Position).Magnitude > 15 then
		return
	end
	local now = os.clock()
	if kind == "special" then
		if now - lastSpecial < Config.SpecialCooldown - 0.5 then
			return
		end
		lastSpecial = now
	else
		if now - lastFire < Config.FireCooldown * 0.75 then
			return
		end
		lastFire = now
	end

	local params = RaycastParams.new()
	params.FilterType = Enum.RaycastFilterType.Exclude
	params.FilterDescendantsInstances = { character }
	local maxArrows = if kind == "special" then Config.SpecialArrows else 1
	local speed = (Config.ArrowSpeed :: { [string]: number })[kind]
	local amount = (Config.Damage :: { [string]: number })[kind]

	for i = 1, math.min(#targets, maxArrows) do
		local target = targets[i]
		if typeof(target) ~= "Vector3" then
			continue
		end
		local delta = target - origin
		if delta.Magnitude < 0.5 then
			continue
		end
		local dir = delta.Unit
		local result = Workspace:Raycast(origin, dir * Config.Range, params)
		local hitPos = if result then result.Position else origin + dir * Config.Range
		local normal = if result then result.Normal else -dir
		toOthers(player, "Arrow", origin, hitPos, kind, normal)
		if result then
			local humanoid = humanoidFrom(result.Instance)
			if humanoid and canDamage(player, humanoid) then
				local travel = (hitPos - origin).Magnitude / speed
				task.delay(travel, function()
					if humanoid.Parent and humanoid.Health > 0 then
						damage(player, humanoid, amount)
					end
				end)
			end
		end
	end
end

remote.OnServerEvent:Connect(function(player: Player, action: any, ...: any)
	if ownerOf() ~= player or typeof(action) ~= "string" then
		return
	end
	if action == "Fire" then
		onFire(player, ...)
	elseif action == "Hook" then
		local hooked = (...) == true
		tool:SetAttribute("Hooked", hooked)
		tool:SetAttribute("DrawStart", if hooked then Workspace:GetServerTimeNow() else 0)
	elseif action == "Anim" then
		-- built-in animations are replicated by relaying them to the other clients
		local name, op, fade, speed = ...
		if typeof(name) ~= "string" or AnimationData[name] == nil then
			return
		end
		if op ~= "play" and op ~= "stop" and op ~= "speed" then
			return
		end
		local t = os.clock()
		animBudget = math.max(0, animBudget - (t - animBudgetAt) * 20)
		animBudgetAt = t
		if animBudget > 40 then
			return
		end
		animBudget += 1
		local character = player.Character
		if character then
			toOthers(player, "Anim", character, name, op,
				if typeof(fade) == "number" then fade else nil,
				if typeof(speed) == "number" then speed else nil)
		end
	elseif action == "Dismiss" then
		local cf = ...
		if typeof(cf) == "CFrame" then
			toOthers(player, "Dismiss", cf)
		end
	elseif action == "Land" then
		local pos = ...
		if typeof(pos) == "Vector3" then
			toOthers(player, "Land", pos)
		end
	end
end)

tool.Equipped:Connect(function()
	local character = tool.Parent
	if not (character and character:IsA("Model")) then
		return
	end
	grip = BowAssembly.attachToHand(tool, character)
	tool:SetAttribute("Hooked", false)
	tool:SetAttribute("DrawStart", 0)
	toOthers(Players:GetPlayerFromCharacter(character), "Summon", tool)
end)

tool.Unequipped:Connect(function()
	if grip then
		grip:Destroy()
		grip = nil
	end
	tool:SetAttribute("Hooked", false)
	tool:SetAttribute("DrawStart", 0)
end)
