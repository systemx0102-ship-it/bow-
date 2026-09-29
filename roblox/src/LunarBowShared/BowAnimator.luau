--!strict
-- One animation API for the bow, whatever the backend:
--   * Config.AnimationIds[name] set  -> Roblox Animator (AnimationTrack, replicates by itself)
--   * empty id                       -> built-in KeyframePlayer (the owner relays play/stop to
--                                       the server so other clients can mirror it)

local Config = require(script.Parent.Config)
local KeyframePlayer = require(script.Parent.KeyframePlayer)

export type Connection = { Disconnect: (self: any) -> () }
export type MarkerSignal = { Connect: (self: any, fn: (value: string?) -> ()) -> Connection }

export type Track = {
	Name: string,
	Builtin: boolean,
	Length: number,
	Play: (self: Track, fadeTime: number?, weight: number?, speed: number?) -> (),
	Stop: (self: Track, fadeTime: number?) -> (),
	AdjustSpeed: (self: Track, speed: number) -> (),
	IsPlaying: (self: Track) -> boolean,
	OnMarker: (self: Track, name: string, fn: (value: string?) -> ()) -> Connection,
	OnStopped: (self: Track, fn: () -> ()) -> Connection,
}

export type Relay = (name: string, action: string, fadeTime: number?, speed: number?) -> ()

export type BowAnimator = {
	Character: Model,
	Get: (self: BowAnimator, name: string) -> Track,
	Play: (self: BowAnimator, name: string, fadeTime: number?, weight: number?, speed: number?) -> Track,
	Stop: (self: BowAnimator, name: string, fadeTime: number?) -> (),
	StopAll: (self: BowAnimator, fadeTime: number?, except: { [string]: boolean }?) -> (),
	Destroy: (self: BowAnimator) -> (),
}

local BowAnimator = {}

local function normaliseId(id: string): string
	if id:match("^%d+$") then
		return "rbxassetid://" .. id
	end
	return id
end

function BowAnimator.usesBuiltin(name: string): boolean
	local id = (Config.AnimationIds :: { [string]: string })[name]
	return id == nil or id == "" or id == "rbxassetid://0"
end

local function wrapRoblox(name: string, animator: Animator, id: string): Track
	local anim = Instance.new("Animation")
	anim.Name = "LunarBow_" .. name
	anim.AnimationId = normaliseId(id)
	local rt = animator:LoadAnimation(anim)
	local track = {
		Name = name,
		Builtin = false,
		Length = 0,
	} :: Track
	function track.Play(self: Track, fadeTime: number?, weight: number?, speed: number?)
		rt:Play(fadeTime or 0.1, weight or 1, speed or 1)
		self.Length = rt.Length
	end
	function track.Stop(_: Track, fadeTime: number?)
		rt:Stop(fadeTime or 0.1)
	end
	function track.AdjustSpeed(_: Track, speed: number)
		rt:AdjustSpeed(speed)
	end
	function track.IsPlaying(_: Track): boolean
		return rt.IsPlaying
	end
	function track.OnMarker(_: Track, marker: string, fn: (value: string?) -> ()): Connection
		return rt:GetMarkerReachedSignal(marker):Connect(fn) :: any
	end
	function track.OnStopped(_: Track, fn: () -> ()): Connection
		return rt.Stopped:Connect(fn) :: any
	end
	task.spawn(function()
		-- Length is 0 until the asset has loaded
		local t0 = os.clock()
		while rt.Length == 0 and os.clock() - t0 < 5 do
			task.wait()
		end
		track.Length = rt.Length
	end)
	return track
end

local function wrapBuiltin(name: string, character: Model, relay: Relay?): Track
	local kt = KeyframePlayer.load(character, name)
	local track = {
		Name = name,
		Builtin = true,
		Length = kt.Length,
	} :: Track
	function track.Play(_: Track, fadeTime: number?, weight: number?, speed: number?)
		kt:Play(fadeTime, weight, speed)
		if relay then
			relay(name, "play", fadeTime, speed)
		end
	end
	function track.Stop(_: Track, fadeTime: number?)
		if kt:IsPlaying() and relay then
			relay(name, "stop", fadeTime, nil)
		end
		kt:Stop(fadeTime)
	end
	function track.AdjustSpeed(_: Track, speed: number)
		kt:AdjustSpeed(speed)
		if relay then
			relay(name, "speed", nil, speed)
		end
	end
	function track.IsPlaying(_: Track): boolean
		return kt:IsPlaying()
	end
	function track.OnMarker(_: Track, marker: string, fn: (value: string?) -> ()): Connection
		return kt:GetMarkerReachedSignal(marker):Connect(fn)
	end
	function track.OnStopped(_: Track, fn: () -> ()): Connection
		return kt.Stopped:Connect(fn)
	end
	return track
end

-- `relay` (optional) is called for built-in tracks so the owner can replicate them.
function BowAnimator.new(character: Model, relay: Relay?): BowAnimator
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	local animator: Animator? = nil
	if humanoid then
		animator = humanoid:FindFirstChildOfClass("Animator")
		if not animator then
			local a = Instance.new("Animator")
			a.Parent = humanoid
			animator = a
		end
	end

	local tracks: { [string]: Track } = {}
	local self = { Character = character } :: BowAnimator

	function self.Get(_: BowAnimator, name: string): Track
		local track = tracks[name]
		if track then
			return track
		end
		local id = (Config.AnimationIds :: { [string]: string })[name]
		local created: Track
		if not BowAnimator.usesBuiltin(name) and animator then
			created = wrapRoblox(name, animator, id)
		else
			created = wrapBuiltin(name, character, relay)
		end
		tracks[name] = created
		return created
	end

	function self.Play(s: BowAnimator, name: string, fadeTime: number?, weight: number?, speed: number?): Track
		local track = s:Get(name)
		track:Play(fadeTime, weight, speed)
		return track
	end

	function self.Stop(_: BowAnimator, name: string, fadeTime: number?)
		local track = tracks[name]
		if track then
			track:Stop(fadeTime)
		end
	end

	function self.StopAll(_: BowAnimator, fadeTime: number?, except: { [string]: boolean }?)
		for name, track in tracks do
			if not (except and except[name]) then
				track:Stop(fadeTime)
			end
		end
	end

	function self.Destroy(s: BowAnimator)
		s:StopAll(0.1)
		table.clear(tracks)
	end

	return self
end

return BowAnimator
