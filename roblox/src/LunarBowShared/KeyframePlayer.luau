--!strict
-- Built-in keyframe player.
--
-- Plays the data in BowAnimationData on any R15 rig by writing Motor6D.Transform
-- in RunService.PreSimulation, i.e. right after Roblox's Animator has run. It
-- blends on top of whatever the Animator produced (walk, jump...), respects
-- priorities, fades, speed, looping and KeyframeMarkers, so it behaves like an
-- AnimationTrack without having to publish the animations first.

local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local Data = require(script.Parent.BowAnimationData)
local Signal = require(script.Parent.Signal)

type AnimationData = Data.AnimationData

local PRIORITY: { [string]: number } = {
	Core = 0,
	Idle = 1,
	Movement = 2,
	Action = 3,
	Action2 = 4,
	Action3 = 5,
	Action4 = 6,
}
local STYLE: { [string]: Enum.EasingStyle } = {
	CubicV2 = Enum.EasingStyle.Cubic,
	Cubic = Enum.EasingStyle.Cubic,
	Elastic = Enum.EasingStyle.Elastic,
	Bounce = Enum.EasingStyle.Bounce,
}
local DIRECTION: { [string]: Enum.EasingDirection } = {
	In = Enum.EasingDirection.In,
	Out = Enum.EasingDirection.Out,
	InOut = Enum.EasingDirection.InOut,
}

export type Track = {
	Name: string,
	Data: AnimationData,
	Looped: boolean,
	Length: number,
	TimePosition: number,
	Speed: number,
	Weight: number,
	Stopped: Signal.Signal,
	Play: (self: Track, fadeTime: number?, weight: number?, speed: number?) -> (),
	Stop: (self: Track, fadeTime: number?) -> (),
	AdjustSpeed: (self: Track, speed: number) -> (),
	IsPlaying: (self: Track) -> boolean,
	GetMarkerReachedSignal: (self: Track, name: string) -> Signal.Signal,
	Destroy: (self: Track) -> (),
}

type TrackState = {
	track: Track,
	fade: number,
	fadeTarget: number,
	fadeRate: number,
	active: boolean,
	stopping: boolean,
	order: number,
	markers: { [string]: Signal.Signal },
}

type Rig = {
	character: Model,
	humanoid: Humanoid?,
	motors: { [string]: Motor6D },
	states: { TrackState },
	written: { [Motor6D]: CFrame },
	connections: { RBXScriptConnection },
}

local KeyframePlayer = {}

local rigs: { [Model]: Rig } = {}
local playCounter = 0
local stepConnection: RBXScriptConnection? = nil

local function ease(alpha: number, style: string, direction: string): number
	if style == "Linear" then
		return alpha
	elseif style == "Constant" then
		return 0
	end
	return TweenService:GetValue(alpha, STYLE[style] or Enum.EasingStyle.Cubic, DIRECTION[direction] or Enum.EasingDirection.Out)
end

local function refreshMotors(rig: Rig)
	table.clear(rig.motors)
	for _, d in rig.character:GetDescendants() do
		if d:IsA("Motor6D") and d.Part1 then
			rig.motors[(d.Part1 :: BasePart).Name] = d
		end
	end
end

local function sampleJoint(data: AnimationData, joint: string, t: number, scale: number): CFrame?
	local keys = data.Keyframes
	local n = #keys
	local a = keys[1]
	if t <= a.Time or n == 1 then
		local cf = a.Poses[joint]
		return cf and (cf - cf.Position + cf.Position * scale)
	end
	for i = 1, n - 1 do
		local k0, k1 = keys[i], keys[i + 1]
		if t < k1.Time then
			local p0, p1 = k0.Poses[joint], k1.Poses[joint]
			if not p0 or not p1 then
				return p0 or p1
			end
			local alpha = ease((t - k0.Time) / (k1.Time - k0.Time), k0.Style, k0.Direction)
			local cf = p0:Lerp(p1, alpha)
			return cf - cf.Position + cf.Position * scale
		end
	end
	local cf = keys[n].Poses[joint]
	return cf and (cf - cf.Position + cf.Position * scale)
end

local function fireMarkers(state: TrackState, from: number, to: number)
	-- fires markers whose keyframe time lies in (from, to]
	for _, key in state.track.Data.Keyframes do
		if key.Time > from and key.Time <= to then
			for _, marker in key.Markers do
				local sig = state.markers[marker[1]]
				if sig then
					sig:Fire(marker[2])
				end
			end
		end
	end
end

local function stepRig(rig: Rig, dt: number)
	local scale = 1
	local humanoid = rig.humanoid
	if humanoid and humanoid.RigType == Enum.HumanoidRigType.R15 and humanoid.HipHeight > 0 then
		scale = humanoid.HipHeight / 2
	end

	-- advance time, markers and fades
	for i = #rig.states, 1, -1 do
		local s = rig.states[i]
		local tr = s.track
		local length = tr.Length
		local prev = tr.TimePosition
		local now = prev + dt * tr.Speed
		if tr.Looped and length > 0 then
			if now >= length then
				fireMarkers(s, prev, length)
				now = now % length
				fireMarkers(s, -1, now)
			else
				fireMarkers(s, prev, now)
			end
		else
			fireMarkers(s, prev, math.min(now, length))
			if now >= length then
				now = length
				if not s.stopping then
					tr:Stop(0.12)
				end
			end
		end
		tr.TimePosition = now

		if s.fade < s.fadeTarget then
			s.fade = math.min(s.fadeTarget, s.fade + s.fadeRate * dt)
		elseif s.fade > s.fadeTarget then
			s.fade = math.max(s.fadeTarget, s.fade - s.fadeRate * dt)
		end
		if s.stopping and s.fade <= 0 then
			s.active = false
			table.remove(rig.states, i)
		end
	end

	-- blend: lowest priority first, so higher priorities override
	table.sort(rig.states, function(a: TrackState, b: TrackState)
		local pa, pb = PRIORITY[a.track.Data.Priority] or 0, PRIORITY[b.track.Data.Priority] or 0
		if pa == pb then
			return a.order < b.order
		end
		return pa < pb
	end)

	local driven: { [Motor6D]: CFrame } = {}
	for _, s in rig.states do
		local w = s.fade * s.track.Weight
		if w > 0.001 then
			for _, joint in s.track.Data.Joints do
				local motor = rig.motors[joint]
				if motor then
					local pose = sampleJoint(s.track.Data, joint, s.track.TimePosition, scale)
					if pose then
						local base = driven[motor]
						if not base then
							local current = motor.Transform
							-- if nobody touched it since our last write, the rest pose is identity
							base = if rig.written[motor] == current then CFrame.identity else current
						end
						driven[motor] = (base :: CFrame):Lerp(pose, math.min(w, 1))
					end
				end
			end
		end
	end

	for motor, cf in driven do
		motor.Transform = cf
	end
	for motor, last in rig.written do
		if not driven[motor] then
			if motor.Parent and motor.Transform == last then
				motor.Transform = CFrame.identity
			end
			rig.written[motor] = nil
		end
	end
	for motor, cf in driven do
		rig.written[motor] = cf
	end
end

local function ensureStepping()
	if stepConnection then
		return
	end
	stepConnection = RunService.PreSimulation:Connect(function(dt: number)
		for character, rig in rigs do
			if not character.Parent then
				KeyframePlayer.releaseRig(character)
			elseif #rig.states > 0 or next(rig.written) then
				stepRig(rig, dt)
			end
		end
	end)
end

local function getRig(character: Model): Rig
	local rig = rigs[character]
	if rig then
		return rig
	end
	local newRig: Rig = {
		character = character,
		humanoid = character:FindFirstChildOfClass("Humanoid"),
		motors = {},
		states = {},
		written = {},
		connections = {},
	}
	refreshMotors(newRig)
	local function onChanged(d: Instance)
		if d:IsA("Motor6D") then
			task.defer(refreshMotors, newRig)
		end
	end
	table.insert(newRig.connections, character.DescendantAdded:Connect(onChanged))
	table.insert(newRig.connections, character.DescendantRemoving:Connect(onChanged))
	rigs[character] = newRig
	ensureStepping()
	return newRig
end

function KeyframePlayer.releaseRig(character: Model)
	local rig = rigs[character]
	if not rig then
		return
	end
	for _, c in rig.connections do
		c:Disconnect()
	end
	rigs[character] = nil
end

function KeyframePlayer.has(name: string): boolean
	return Data[name] ~= nil
end

-- Creates a track for animation `name` on `character`.
function KeyframePlayer.load(character: Model, name: string): Track
	local data = Data[name]
	assert(data, "Unknown Lunar Bow animation: " .. tostring(name))
	local rig = getRig(character)

	local track = {
		Name = name,
		Data = data,
		Looped = data.Loop,
		Length = data.Length,
		TimePosition = 0,
		Speed = 1,
		Weight = 1,
		Stopped = Signal.new(),
	} :: Track
	local state: TrackState = {
		track = track,
		fade = 0,
		fadeTarget = 0,
		fadeRate = 1,
		active = false,
		stopping = false,
		order = 0,
		markers = {},
	}

	function track.Play(self: Track, fadeTime: number?, weight: number?, speed: number?)
		local fade = fadeTime or 0.1
		self.Weight = weight or 1
		self.Speed = speed or 1
		self.TimePosition = 0
		playCounter += 1
		state.order = playCounter
		state.stopping = false
		state.fadeTarget = 1
		state.fadeRate = if fade > 0 then 1 / fade else math.huge
		if not state.active then
			state.active = true
			state.fade = 0
			table.insert(rig.states, state)
		end
		fireMarkers(state, -1, 0)
	end

	function track.Stop(self: Track, fadeTime: number?)
		if not state.active or state.stopping then
			return
		end
		local fade = fadeTime or 0.1
		state.stopping = true
		state.fadeTarget = 0
		state.fadeRate = if fade > 0 then 1 / fade else math.huge
		self.Stopped:Fire()
	end

	function track.AdjustSpeed(self: Track, speed: number)
		self.Speed = speed
	end

	function track.IsPlaying(_: Track): boolean
		return state.active and not state.stopping
	end

	function track.GetMarkerReachedSignal(_: Track, markerName: string): Signal.Signal
		local sig = state.markers[markerName]
		if not sig then
			sig = Signal.new()
			state.markers[markerName] = sig
		end
		return sig :: Signal.Signal
	end

	function track.Destroy(self: Track)
		self:Stop(0)
		self.Stopped:DisconnectAll()
		for _, sig in state.markers do
			sig:DisconnectAll()
		end
	end

	return track
end

return KeyframePlayer
