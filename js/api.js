async function request(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = data?.error || data?.message || `请求失败（${response.status}）`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAgentHealth() {
  try {
    return await request("/api/health", { method: "GET" }, 5000);
  } catch {
    return { ok: false, mode: "static", agent: false, reason: "当前以静态文件运行，未启动 Node 服务。" };
  }
}

export async function runRemoteAgent(payload) {
  return request("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, 180000);
}

export async function loginAdminAgent(key) {
  return request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key })
  }, 15000);
}

export async function logoutAdminAgent() {
  return request("/api/admin/logout", { method: "POST" }, 15000);
}

export async function setAdminPublicAgent(open, minutes = 30) {
  return request("/api/admin/public-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ open, minutes })
  }, 15000);
}
