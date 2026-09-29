--!strict
-- Lunar Bow — cosmetic effects for EVERY bow in the server (StarterPlayerScripts).
--   * string that bends to the right hand, nocked arrow, charge glow
--   * other players' arrows, impacts, summon / dismiss / landing effects
--   * mirrors other players' built-in animations (when not using published ids)

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("LunarBowShared")
local BowVFX = require(Shared:WaitForChild("BowVFX"))
local BowAnimator = require(Shared:WaitForChild("BowAnimator"))
local BowAssembly = require(Shared:WaitForChild("BowAssembly"))
local AnimationData = require(Shared:WaitForChild("BowAnimationData"))
local FX = Shared:WaitForChild("FX") :: RemoteEvent

local localPlayer = Players.LocalPlayer

type Tracker = { update: (dt: number) -> (), destroy: () -> () }
local trackers: { [Tool]: Tracker } = {}
local animators: { [Model]: BowAnimator.BowAnimator } = {}
local holding: { [Tool]: Model } = {}

local function animatorFor(character: Model): BowAnimator.BowAnimator
	local a = animators[character]
	if not a then
		a = BowAnimator.new(character)
		animators[character] = a
		character.Destroying:Connect(function()
			animators[character] = nil
		end)
	end
	return a :: BowAnimator.BowAnimator
end

local function isLocal(character: Instance?): boolean
	return character ~= nil and character == localPlayer.Character
end

-- other players' Hold loop is started locally (nothing to replicate, works for late joiners)
local function refreshHold(tool: Tool)
	local parent = tool.Parent
	local char = if parent and parent:IsA("Model") and parent:FindFirstChildOfClass("Humanoid") then parent else nil
	local previous = holding[tool]
	if previous and previous ~= char then
		holding[tool] = nil
		if not isLocal(previous) and BowAnimator.usesBuiltin("Hold") and animators[previous] then
			animators[previous]:Stop("Hold", 0.2)
		end
	end
	if char and previous ~= char then
		holding[tool] = char
		if not isLocal(char) and BowAnimator.usesBuiltin("Hold") then
			animatorFor(char):Play("Hold", 0.3)
		end
	end
end

local function addBow(inst: Instance)
	if not inst:IsA("Tool") or trackers[inst] then
		return
	end
	local tool = inst
	task.spawn(function()
		local handle = tool:WaitForChild("BowHandle", 15)
		if not handle or not handle:WaitForChild("StringNock", 15) then
			return
		end
		local tracker = BowVFX.trackBow(tool)
		if tracker then
			trackers[tool] = tracker
		end
		refreshHold(tool)
		tool.AncestryChanged:Connect(function()
			refreshHold(tool)
		end)
	end)
end

local function removeBow(inst: Instance)
	if inst:IsA("Tool") then
		local tracker = trackers[inst]
		if tracker then
			tracker.destroy()
			trackers[inst] = nil
		end
	end
end

CollectionService:GetInstanceAddedSignal(BowAssembly.Tag):Connect(addBow)
CollectionService:GetInstanceRemovedSignal(BowAssembly.Tag):Connect(removeBow)
for _, t in CollectionService:GetTagged(BowAssembly.Tag) do
	addBow(t)
end

RunService.RenderStepped:Connect(function(dt: number)
	for tool, tracker in trackers do
		if not tool.Parent then
			tracker.destroy()
			trackers[tool] = nil
		elseif tool:IsDescendantOf(Workspace) then
			tracker.update(dt)
		end
	end
end)

FX.OnClientEvent:Connect(function(kind: string, ...: any)
	if kind == "Arrow" then
		local origin, hit, arrowKind, normal = ...
		BowVFX.fireArrow(origin, hit, arrowKind, normal)
	elseif kind == "Summon" then
		local tool = ...
		if typeof(tool) == "Instance" then
			BowVFX.hideBow(tool)
			task.delay(0.14, BowVFX.summon, tool)
		end
	elseif kind == "Dismiss" then
		local cf = ...
		BowVFX.dismiss(nil, cf)
	elseif kind == "Land" then
		local pos = ...
		BowVFX.landing(pos)
	elseif kind == "Anim" then
		local character, name, op, fade, speed = ...
		if typeof(character) ~= "Instance" or not character:IsA("Model") or isLocal(character) then
			return
		end
		if typeof(name) ~= "string" or AnimationData[name] == nil then
			return
		end
		if not BowAnimator.usesBuiltin(name) then
			return -- published animations replicate on their own
		end
		local a = animatorFor(character)
		if op == "play" then
			a:Play(name, fade, 1, speed)
		elseif op == "stop" then
			a:Stop(name, fade)
		elseif op == "speed" and typeof(speed) == "number" then
			a:Get(name):AdjustSpeed(speed)
		end
	end
end)
