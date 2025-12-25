"""
TiaCC Python Client - 测试框架集成钩子

Usage:
    from tia_hooks import TiaHooks

    hooks = TiaHooks()
    hooks.connect()

    for test in tests:
        hooks.before_test(test.name)
        run_test(test)
        hooks.after_test(test.name)

    hooks.disconnect()
"""

import socket
import json
from typing import Optional, Any
from dataclasses import dataclass


@dataclass
class TiaConfig:
    host: str = "127.0.0.1"
    port: int = 19840
    timeout: float = 5.0
    mode: str = "precise"  # "precise" or "bucket"
    bucket_size: int = 50
    language: str = "cpp"  # "cpp" or "csharp"


class TiaHooks:
    def __init__(self, config: Optional[TiaConfig] = None):
        self.config = config or TiaConfig()
        self._socket: Optional[socket.socket] = None
        self._request_id = 0
        self._bucket_count = 0
        self._bucket_tests: list[str] = []

    def connect(self) -> bool:
        """连接到覆盖率服务"""
        try:
            self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._socket.settimeout(self.config.timeout)
            self._socket.connect((self.config.host, self.config.port))
            return True
        except Exception as e:
            print(f"[TiaCC] 连接失败: {e}")
            return False

    def disconnect(self):
        """断开连接"""
        if self._socket:
            self._socket.close()
            self._socket = None

    def _send_rpc(self, method: str, params: Optional[dict] = None) -> Optional[dict]:
        """发送 JSON-RPC 请求"""
        if not self._socket:
            return None

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
            "id": self._request_id
        }

        try:
            self._socket.send((json.dumps(request) + "\n").encode())
            response = self._socket.recv(4096).decode().strip()
            return json.loads(response).get("result")
        except Exception as e:
            print(f"[TiaCC] RPC 错误: {e}")
            return None

    def start_recording(self, test_id: str) -> bool:
        result = self._send_rpc("startRecording", {
            "testId": test_id,
            "language": self.config.language
        })
        return result.get("success", False) if result else False

    def stop_recording(self, test_id: str) -> bool:
        result = self._send_rpc("stopRecording", {"testId": test_id})
        return result.get("success", False) if result else False

    def dump_coverage(self, test_id: str, output_path: Optional[str] = None) -> bool:
        params = {"testId": test_id}
        if output_path:
            params["outputPath"] = output_path
        result = self._send_rpc("dumpCoverage", params)
        return result.get("success", False) if result else False

    def reset_all(self) -> bool:
        result = self._send_rpc("resetAll")
        return result.get("success", False) if result else False

    def get_status(self) -> Optional[dict]:
        return self._send_rpc("getStatus")

    # 高级 API
    def before_test(self, test_id: str):
        """测试前调用"""
        if self.config.mode == "precise":
            self.start_recording(test_id)
        else:
            self._bucket_tests.append(test_id)
            self._bucket_count += 1
            if self._bucket_count == 1:
                self.start_recording(f"bucket_{self._request_id // self.config.bucket_size}")

    def after_test(self, test_id: str):
        """测试后调用"""
        if self.config.mode == "precise":
            self.stop_recording(test_id)
            self.dump_coverage(test_id)
        elif self._bucket_count >= self.config.bucket_size:
            self.flush_bucket()

    def flush_bucket(self):
        """刷新当前桶"""
        if self._bucket_count > 0:
            bucket_id = f"bucket_{self._request_id // self.config.bucket_size}"
            self.stop_recording(bucket_id)
            self.dump_coverage(bucket_id)
            self._bucket_tests.clear()
            self._bucket_count = 0


# 使用示例
if __name__ == "__main__":
    hooks = TiaHooks(TiaConfig(mode="precise"))

    if hooks.connect():
        print("状态:", hooks.get_status())

        # 模拟测试
        hooks.before_test("test_example")
        # ... 运行测试 ...
        hooks.after_test("test_example")

        hooks.disconnect()
