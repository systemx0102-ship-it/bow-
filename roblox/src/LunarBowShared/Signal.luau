--!strict
-- Minimal signal with the same shape as RBXScriptSignal (Connect / Once / Disconnect).

export type Connection = {
	Connected: boolean,
	Disconnect: (self: Connection) -> (),
}

export type Signal = {
	Connect: (self: Signal, fn: (...any) -> ()) -> Connection,
	Once: (self: Signal, fn: (...any) -> ()) -> Connection,
	Fire: (self: Signal, ...any) -> (),
	DisconnectAll: (self: Signal) -> (),
}

local Signal = {}

function Signal.new(): Signal
	local handlers: { [Connection]: (...any) -> () } = {}
	local self = {} :: Signal

	function self.Connect(_: Signal, fn: (...any) -> ()): Connection
		local conn = { Connected = true } :: Connection
		function conn.Disconnect(c: Connection)
			c.Connected = false
			handlers[c] = nil
		end
		handlers[conn] = fn
		return conn
	end

	function self.Once(s: Signal, fn: (...any) -> ()): Connection
		local conn: Connection
		conn = s:Connect(function(...)
			conn:Disconnect()
			fn(...)
		end)
		return conn
	end

	function self.Fire(_: Signal, ...: any)
		for conn, fn in table.clone(handlers) do
			if conn.Connected then
				task.spawn(fn, ...)
			end
		end
	end

	function self.DisconnectAll(_: Signal)
		for conn in handlers do
			conn.Connected = false
		end
		table.clear(handlers)
	end

	return self
end

return Signal
