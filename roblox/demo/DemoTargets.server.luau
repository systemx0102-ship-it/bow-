--!strict
-- Demo only: spawns R15 training dummies to shoot at (they respawn when defeated).

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local SPOTS = {
	Vector3.new(-14, 0, -30),
	Vector3.new(0, 0, -45),
	Vector3.new(16, 0, -34),
	Vector3.new(30, 0, -70),
}

local folder = Instance.new("Folder")
folder.Name = "TrainingDummies"
folder.Parent = Workspace

local function spawnDummy(pos: Vector3)
	local desc = Instance.new("HumanoidDescription")
	desc.HeadColor = Color3.fromRGB(200, 205, 220)
	desc.TorsoColor = Color3.fromRGB(60, 70, 110)
	desc.LeftArmColor = desc.HeadColor
	desc.RightArmColor = desc.HeadColor
	desc.LeftLegColor = Color3.fromRGB(40, 45, 70)
	desc.RightLegColor = desc.LeftLegColor
	local dummy = Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	dummy.Name = "Dummy"
	local humanoid = dummy:FindFirstChildOfClass("Humanoid") :: Humanoid
	humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.Subject
	humanoid.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOn
	humanoid.MaxHealth = 150
	humanoid.Health = 150
	dummy:PivotTo(CFrame.lookAt(pos + Vector3.new(0, 3, 0), Vector3.new(0, 3, 20)))
	dummy.Parent = folder
	humanoid.Died:Connect(function()
		task.wait(3)
		dummy:Destroy()
		spawnDummy(pos)
	end)
end

for _, p in SPOTS do
	spawnDummy(p)
end
