--[[
    TiaCC Lua Integration Hooks

    Provides hooks for integrating TiaCC coverage collection with Lua test frameworks.
    Communicates with the TiaCC coverage service via TCP JSON-RPC.

    Usage:
        local TiaHooks = require("tia_hooks")

        -- Initialize connection
        TiaHooks:init({
            host = "127.0.0.1",
            port = 19840,  -- C++ service port (use 19841 for .NET)
            mode = "precise"  -- or "bucket"
        })

        -- In your test runner
        function runTest(testId)
            TiaHooks:beforeTest(testId)
            -- run actual test
            local success = pcall(executeTest)
            TiaHooks:afterTest(testId)
            return success
        end
]]

local socket = require("socket")

-- Try to load cjson, fall back to a simple JSON encoder if not available
local json
local ok, cjson = pcall(require, "cjson")
if ok then
    json = cjson
else
    -- Minimal JSON implementation for basic objects
    json = {
        encode = function(obj)
            if type(obj) == "table" then
                local parts = {}
                local is_array = #obj > 0
                for k, v in pairs(obj) do
                    local key = is_array and "" or ('"' .. tostring(k) .. '":')
                    local val
                    if type(v) == "string" then
                        val = '"' .. v:gsub('"', '\\"') .. '"'
                    elseif type(v) == "number" or type(v) == "boolean" then
                        val = tostring(v)
                    elseif type(v) == "table" then
                        val = json.encode(v)
                    else
                        val = "null"
                    end
                    table.insert(parts, key .. val)
                end
                if is_array then
                    return "[" .. table.concat(parts, ",") .. "]"
                else
                    return "{" .. table.concat(parts, ",") .. "}"
                end
            elseif type(obj) == "string" then
                return '"' .. obj:gsub('"', '\\"') .. '"'
            else
                return tostring(obj)
            end
        end,
        decode = function(str)
            -- Very basic JSON decoder - only handles simple responses
            local success = str:match('"success"%s*:%s*(true)')
            return { result = { success = success ~= nil } }
        end
    }
end

--------------------------------------------------------------------------------
-- TiaHooks Module
--------------------------------------------------------------------------------

local TiaHooks = {
    -- Connection state
    connection = nil,
    connected = false,

    -- Configuration
    config = {
        host = "127.0.0.1",
        port = 19840,
        timeout = 5,
        mode = "precise",  -- "precise" or "bucket"
        bucketSize = 50,
        outputDir = "coverage_data",
        language = "cpp",  -- "cpp" or "csharp"
        autoReconnect = true,
        debug = false
    },

    -- Bucket mode state
    bucket = {
        tests = {},
        count = 0
    },

    -- Request ID counter
    requestId = 0
}

--------------------------------------------------------------------------------
-- Utility Functions
--------------------------------------------------------------------------------

local function log(msg)
    if TiaHooks.config.debug then
        print("[TiaCC] " .. msg)
    end
end

local function logError(msg)
    print("[TiaCC ERROR] " .. msg)
end

--------------------------------------------------------------------------------
-- Connection Management
--------------------------------------------------------------------------------

function TiaHooks:init(config)
    -- Merge provided config with defaults
    if config then
        for k, v in pairs(config) do
            self.config[k] = v
        end
    end

    log("Initializing with config:")
    log("  Host: " .. self.config.host)
    log("  Port: " .. self.config.port)
    log("  Mode: " .. self.config.mode)

    return self:connect()
end

function TiaHooks:connect()
    if self.connected then
        return true
    end

    log("Connecting to coverage service...")

    self.connection = socket.tcp()
    self.connection:settimeout(self.config.timeout)

    local success, err = self.connection:connect(
        self.config.host,
        self.config.port
    )

    if not success then
        logError("Failed to connect: " .. tostring(err))
        self.connection = nil
        return false
    end

    self.connected = true
    log("Connected successfully")
    return true
end

function TiaHooks:disconnect()
    if self.connection then
        self.connection:close()
        self.connection = nil
        self.connected = false
        log("Disconnected")
    end
end

function TiaHooks:ensureConnected()
    if not self.connected and self.config.autoReconnect then
        return self:connect()
    end
    return self.connected
end

--------------------------------------------------------------------------------
-- JSON-RPC Communication
--------------------------------------------------------------------------------

function TiaHooks:sendRpc(method, params)
    if not self:ensureConnected() then
        return nil, "Not connected"
    end

    self.requestId = self.requestId + 1

    local request = {
        jsonrpc = "2.0",
        method = method,
        params = params or {},
        id = self.requestId
    }

    local requestJson = json.encode(request)
    log("Sending: " .. requestJson)

    local success, err = self.connection:send(requestJson .. "\n")
    if not success then
        logError("Send failed: " .. tostring(err))
        self.connected = false
        return nil, err
    end

    -- Read response
    local response, err = self.connection:receive("*l")
    if not response then
        logError("Receive failed: " .. tostring(err))
        self.connected = false
        return nil, err
    end

    log("Received: " .. response)

    local decoded = json.decode(response)
    if decoded.error then
        return nil, decoded.error.message
    end

    return decoded.result
end

--------------------------------------------------------------------------------
-- Coverage Control API
--------------------------------------------------------------------------------

function TiaHooks:startRecording(testId)
    return self:sendRpc("startRecording", {
        testId = testId,
        language = self.config.language
    })
end

function TiaHooks:stopRecording(testId)
    return self:sendRpc("stopRecording", {
        testId = testId
    })
end

function TiaHooks:dumpCoverage(testId, outputPath)
    outputPath = outputPath or (self.config.outputDir .. "/" .. testId .. ".profraw")
    return self:sendRpc("dumpCoverage", {
        testId = testId,
        outputPath = outputPath
    })
end

function TiaHooks:resetAll()
    return self:sendRpc("resetAll", {})
end

function TiaHooks:getStatus()
    return self:sendRpc("getStatus", {})
end

--------------------------------------------------------------------------------
-- Test Hooks (High-Level API)
--------------------------------------------------------------------------------

function TiaHooks:beforeTest(testId)
    if self.config.mode == "precise" then
        -- Precise mode: start recording for this specific test
        local result, err = self:startRecording(testId)
        if not result then
            logError("Failed to start recording for " .. testId .. ": " .. tostring(err))
            return false
        end
        return true

    else
        -- Bucket mode: just track the test
        self:addToBucket(testId)
        if self.bucket.count == 1 then
            -- First test in bucket, start recording
            local bucketId = self:getCurrentBucketId()
            local result, err = self:startRecording(bucketId)
            if not result then
                logError("Failed to start bucket recording: " .. tostring(err))
                return false
            end
        end
        return true
    end
end

function TiaHooks:afterTest(testId)
    if self.config.mode == "precise" then
        -- Precise mode: stop and dump immediately
        self:stopRecording(testId)
        local result, err = self:dumpCoverage(testId)
        if not result then
            logError("Failed to dump coverage for " .. testId .. ": " .. tostring(err))
            return false
        end
        return true

    else
        -- Bucket mode: check if bucket is full
        if self:isBucketFull() then
            return self:flushBucket()
        end
        return true
    end
end

--------------------------------------------------------------------------------
-- Bucket Mode Functions
--------------------------------------------------------------------------------

function TiaHooks:addToBucket(testId)
    table.insert(self.bucket.tests, testId)
    self.bucket.count = self.bucket.count + 1
end

function TiaHooks:isBucketFull()
    return self.bucket.count >= self.config.bucketSize
end

function TiaHooks:getCurrentBucketId()
    return "bucket_" .. math.floor(self.requestId / self.config.bucketSize)
end

function TiaHooks:flushBucket()
    if self.bucket.count == 0 then
        return true
    end

    local bucketId = self:getCurrentBucketId()
    log("Flushing bucket: " .. bucketId .. " (" .. self.bucket.count .. " tests)")

    self:stopRecording(bucketId)
    local result, err = self:dumpCoverage(bucketId)

    -- Reset bucket
    self.bucket.tests = {}
    self.bucket.count = 0

    if not result then
        logError("Failed to flush bucket: " .. tostring(err))
        return false
    end

    return true
end

--------------------------------------------------------------------------------
-- Test Runner Integration
--------------------------------------------------------------------------------

function TiaHooks:runSingleTest(testId, testFunc)
    self:beforeTest(testId)

    local success, err = pcall(testFunc)

    self:afterTest(testId)

    if not success then
        return false, err
    end
    return true
end

function TiaHooks:runTestSuite(tests)
    local passed = 0
    local failed = 0
    local errors = {}

    for _, test in ipairs(tests) do
        local testId = test.id or test.name or tostring(_)
        local testFunc = test.func or test.run or test

        local success, err = self:runSingleTest(testId, testFunc)
        if success then
            passed = passed + 1
        else
            failed = failed + 1
            errors[testId] = err
        end
    end

    -- Flush any remaining bucket
    if self.config.mode == "bucket" then
        self:flushBucket()
    end

    return {
        passed = passed,
        failed = failed,
        errors = errors
    }
end

--------------------------------------------------------------------------------
-- Configuration Helpers
--------------------------------------------------------------------------------

function TiaHooks:loadConfig(configPath)
    local file = io.open(configPath, "r")
    if not file then
        log("Config file not found: " .. configPath)
        return self.config
    end

    local content = file:read("*a")
    file:close()

    local config = json.decode(content)
    if config then
        for k, v in pairs(config) do
            self.config[k] = v
        end
    end

    return self.config
end

return TiaHooks
