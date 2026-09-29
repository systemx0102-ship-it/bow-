--[[
	Lunar Bow — offline tests for the built-in keyframe player (run with Lune):

		lune run tests/keyframe_player.test.luau        (from the repository root)

	* Every animations/*.rbxmx must load as a KeyframeSequence.
	* KeyframePlayer (fed by BowAnimationData.luau) must reproduce the poses of the
	  .rbxmx files, sampled here with an independent implementation of Roblox's
	  Pose interpolation (CFrame:Lerp + easing of the earlier keyframe).
	* Markers fire once and in order, priorities override, joints return to rest.
]]

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local task = require("@lune/task")

local CFrame, Vector3, Enum = roblox.CFrame, roblox.Vector3, roblox.Enum
local ROOT = process.cwd
local SHARED = ROOT .. "/roblox/src/LunarBowShared/"

local failures = 0
local function check(label: string, ok: boolean)
	print((if ok then "PASS " else "FAIL ") .. label)
	if not ok then
		failures += 1
	end
end

local function cubic(a: number, dir: string): number
	if dir == "In" then
		return a ^ 3
	elseif dir == "Out" then
		return 1 - (1 - a) ^ 3
	end
	return if a < 0.5 then 4 * a ^ 3 else 1 - (-2 * a + 2) ^ 3 / 2
end

-- mocked Roblox services -----------------------------------------------------
local preSimulation = {}
local TweenService = {
	GetValue = function(_, a, _style, dir)
		return cubic(a, dir.Name)
	end,
}
local RunService = {
	PreSimulation = {
		Connect = function(_, fn)
			table.insert(preSimulation, fn)
			return { Disconnect = function() end }
		end,
	},
}
local game = {
	GetService = function(_, name)
		if name == "TweenService" then
			return TweenService
		elseif name == "RunService" then
			return RunService
		end
		error("service not mocked: " .. name)
	end,
}

local modules = {}
local function load(name: string)
	if modules[name] then
		return modules[name]
	end
	local scriptObj = {
		Parent = setmetatable({}, {
			__index = function(_, k)
				return { __module = k }
			end,
		}),
	}
	local env = setmetatable({
		game = game,
		script = scriptObj,
		CFrame = CFrame,
		Vector3 = Vector3,
		Enum = Enum,
		task = task,
		require = function(m)
			return load(m.__module)
		end,
	}, { __index = _G })
	local chunk = luau.load(fs.readFile(SHARED .. name .. ".luau"), { debugName = name, environment = env })
	modules[name] = chunk()
	return modules[name]
end
modules.Config = { AnimationIds = {} } -- empty ids -> built-in player
local BowAnimator = load("BowAnimator")
local Data = load("BowAnimationData")

-- mocked R15 rig ---------------------------------------------------------------
local JOINTS = {
	"LowerTorso", "UpperTorso", "Head", "LeftUpperArm", "LeftLowerArm", "LeftHand", "RightUpperArm",
	"RightLowerArm", "RightHand", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg",
	"RightLowerLeg", "RightFoot", "BowHandle",
}
local motors = {}
for _, n in JOINTS do
	motors[n] = {
		Part1 = { Name = n },
		Transform = CFrame.identity,
		Parent = true,
		IsA = function(_, c)
			return c == "Motor6D"
		end,
	}
end
local function signal()
	return {
		Connect = function()
			return { Disconnect = function() end }
		end,
	}
end
local animatorObj = {
	IsA = function()
		return true
	end,
}
local humanoid = {
	RigType = Enum.HumanoidRigType.R15,
	HipHeight = 2,
	FindFirstChildOfClass = function()
		return animatorObj
	end,
}
local character = {
	Parent = true,
	GetDescendants = function()
		local t = {}
		for _, m in motors do
			table.insert(t, m)
		end
		return t
	end,
	FindFirstChildOfClass = function(_, c)
		return if c == "Humanoid" then humanoid else nil
	end,
	DescendantAdded = signal(),
	DescendantRemoving = signal(),
}

local DT = 1 / 240
local function stepTicks(n: number)
	for _ = 1, n do
		for _, fn in preSimulation do
			fn(DT)
		end
	end
end
local function step(seconds: number)
	stepTicks(math.floor(seconds / DT + 0.5))
end

-- independent sampler working on the KeyframeSequence instances ----------------
type Key = { time: number, poses: { [string]: any }, style: string, dir: string }

local function readSequence(name: string): (any, { Key })
	local path = ROOT .. "/animations/LunarBow_" .. name .. ".rbxmx"
	local kfs = roblox.deserializeModel(fs.readFile(path))[1]
	local keys: { Key } = {}
	for _, kf in kfs:GetChildren() do
		if kf.ClassName == "Keyframe" then
			local k: Key = { time = kf.Time, poses = {}, style = "Linear", dir = "Out" }
			for _, pose in kf:GetDescendants() do
				if pose.ClassName == "Pose" and pose.Weight > 0 then
					k.poses[pose.Name] = pose.CFrame
					k.style = pose.EasingStyle.Name
					k.dir = pose.EasingDirection.Name
				end
			end
			table.insert(keys, k)
		end
	end
	table.sort(keys, function(a, b)
		return a.time < b.time
	end)
	return kfs, keys
end

local function sampleSequence(keys: { Key }, joint: string, t: number): any
	if t <= keys[1].time then
		return keys[1].poses[joint]
	end
	for i = 1, #keys - 1 do
		local a, b = keys[i], keys[i + 1]
		if t < b.time then
			local alpha = (t - a.time) / (b.time - a.time)
			if a.style == "Constant" then
				alpha = 0
			elseif a.style ~= "Linear" then
				alpha = cubic(alpha, a.dir)
			end
			return a.poses[joint]:Lerp(b.poses[joint], alpha)
		end
	end
	return keys[#keys].poses[joint]
end

local function maxError(a: any, b: any): number
	local ca, cb = { a:GetComponents() }, { b:GetComponents() }
	local worst = 0
	for i = 1, 12 do
		worst = math.max(worst, math.abs(ca[i] - cb[i]))
	end
	return worst
end

-- tests -------------------------------------------------------------------------
local anim = BowAnimator.new(character)
local names = {}
for name in Data do
	table.insert(names, name)
end
table.sort(names)

for _, name in names do
	local kfs, keys = readSequence(name)
	local d = Data[name]
	check(("%s: rbxmx loads (%d keyframes, priority %s)"):format(name, #keys, kfs.Priority.Name),
		kfs.ClassName == "KeyframeSequence" and #keys == #d.Keyframes and kfs.Priority.Name == d.Priority
			and kfs.Loop == d.Loop)

	local markers = {}
	local track = anim:Get(name)
	local expected = {}
	for _, k in d.Keyframes do
		for _, m in k.Markers do
			table.insert(expected, m[1])
			track:OnMarker(m[1], function()
				table.insert(markers, m[1])
			end)
		end
	end
	local seen = {}
	local unique = {}
	for _, m in expected do
		if not seen[m] then
			seen[m] = true
			table.insert(unique, m)
		end
	end

	track:Play(0)
	local worst, ticks = 0, 0
	local length = d.Length
	for i = 1, 9 do
		-- sample on exact ticks so the comparison is not blurred by rounding
		local target = math.floor(length * (i - 0.5) / 9 / DT)
		stepTicks(target - ticks)
		ticks = target
		local t = ticks * DT
		for _, joint in d.Joints do
			local want = sampleSequence(keys, joint, t)
			if want then
				worst = math.max(worst, maxError(motors[joint].Transform, want))
			end
		end
	end
	check(("%s: player matches the KeyframeSequence (max error %.4f)"):format(name, worst), worst < 0.03)

	if d.Loop then
		track:Stop(0)
	else
		step(length)
	end
	task.wait()
	check(("%s: markers fired once, in order [%s]"):format(name, table.concat(markers, ",")),
		table.concat(markers, ",") == table.concat(expected, ","))
	check(name .. ": track stopped", not track:IsPlaying())
	step(0.3)
end

local rest = true
for _, m in motors do
	rest = rest and m.Transform == CFrame.identity
end
check("all joints back to rest after every track stopped", rest)

anim:Play("Hold", 0)
anim:Play("Draw", 0)
step(0.44)
local _, drawKeys = readSequence("Draw")
check("Draw (Action) overrides Hold (Movement) on shared joints",
	maxError(motors.RightUpperArm.Transform, sampleSequence(drawKeys, "RightUpperArm", 0.44)) < 0.03)
anim:StopAll(0)
step(0.1)
motors.LeftUpperLeg.Transform = CFrame.Angles(0.3, 0, 0)
anim:Play("Hold", 0)
step(1 / 60)
check("joints driven only by the Roblox Animator are left untouched",
	motors.LeftUpperLeg.Transform == CFrame.Angles(0.3, 0, 0))

print(if failures == 0 then "\nALL TESTS PASSED" else ("\n%d FAILURE(S)"):format(failures))
if failures > 0 then
	process.exit(1)
end
