--!strict
-- Arco Lunar / Lunar Bow — settings shared by server and client.

local Config = {}

-- Size multiplier over the authored bow (≈4.5 studs tip to tip at 1).
Config.BowScale = 1

-- Published animation asset ids. Leave a value empty ("") to use the built-in
-- keyframe player instead (works in Studio and in live games without uploading
-- anything). To use Roblox's own Animator, import the .rbxmx files from
-- /animations, publish them from the Animation Editor and paste the ids here,
-- e.g. Hold = "rbxassetid://1234567890".
Config.AnimationIds = {
	Hold = "",
	Equip = "",
	Draw = "",
	Aim = "",
	AimStance = "",
	Shoot = "",
	ShootCharged = "",
	Special = "",
	Unequip = "",
}

-- Optional: ColorMap image ids used as MeshPart.TextureID when a part has no
-- SurfaceAppearance (SurfaceAppearance maps can only be set from Studio).
Config.TextureIds = {
	Limbs = "",
	Armor = "",
	Grip = "",
}

-- Combat ---------------------------------------------------------------------
Config.Damage = {
	normal = 22,
	charged = 55,
	special = 20, -- per arrow
}
Config.ArrowSpeed = {
	normal = 280,
	charged = 380,
	special = 300,
}
Config.Range = 500
Config.FireCooldown = 0.28 -- seconds between shots
Config.ChargeTime = 0.9 -- seconds at full draw to get a charged shot
Config.SpecialCooldown = 6
Config.SpecialArrows = 3
Config.SpecialSpread = 6 -- degrees between special arrows
Config.TeamCheck = true -- don't damage players on the same (non-neutral) team

-- Special move ("Salto Lunar") jump arc
Config.SpecialJumpHeight = 8
Config.SpecialJumpBack = 14 -- studs travelled backwards

-- Feel -----------------------------------------------------------------------
Config.AimWalkSpeedMultiplier = 0.55
Config.AimFieldOfView = 60
Config.AimCameraOffset = Vector3.new(1.4, 0.35, 0)
Config.SpecialKeys = { Enum.KeyCode.Q, Enum.KeyCode.ButtonY }

-- Look -----------------------------------------------------------------------
Config.Colors = {
	Glow = Color3.fromRGB(90, 215, 255),
	GlowDeep = Color3.fromRGB(30, 110, 255),
	Charged = Color3.fromRGB(190, 245, 255),
	Body = Color3.fromRGB(28, 34, 58),
	Gold = Color3.fromRGB(214, 186, 128),
	Grip = Color3.fromRGB(30, 32, 46),
}
Config.AuraIdleTransparency = 0.82 -- 1 = hidden
Config.AuraChargedTransparency = 0.15
Config.ShowPlaceholderIfMeshesMissing = true

return Config
