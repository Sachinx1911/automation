// server अडकला/क्रॅश झाला, किंवा "port already in use" सारखा error आला, तर हे
// चालवा — port मोकळा करते आणि उघडे राहिलेले Chrome processes बंद करते.
//
// वापर: npm run clean
//
// Windows, macOS आणि Linux — तिन्हीवर चालते.

const { spawnSync } = require("child_process");

const isWindows = process.platform === "win32";

function runPS(script) {
  const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf-8",
  });
  return (res.stdout || "").trim();
}

function runSh(cmd) {
  const res = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf-8" });
  return (res.stdout || "").trim();
}

function killPids(pids, label) {
  pids.forEach((pid) => {
    console.log(`  ${label} (PID ${pid}) बंद करतो...`);
    if (isWindows) {
      runPS(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
    } else {
      runSh(`kill -9 ${pid} 2>/dev/null`);
    }
  });
}

function killPort(port) {
  console.log(`\nport ${port} वर काही चालू आहे का तपासतो...`);

  const out = isWindows
    ? runPS(
        `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`
      )
    : runSh(`lsof -ti tcp:${port} 2>/dev/null`);

  const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
  if (!pids.length) {
    console.log(`  port ${port} आधीच मोकळा आहे.`);
    return;
  }
  killPids(pids, `port ${port} वापरणारा server`);
}

function killOrphanedChrome() {
  console.log("\nautomation चा shared browser profile वापरणारे Chrome processes शोधतो...");

  const out = isWindows
    ? runPS(
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*.browser-profiles*shared*' } | Select-Object -ExpandProperty ProcessId`
      )
    : // -f = पूर्ण command line मध्ये शोध; automation चा profile वापरणारेच पकडले
      // जातात, त्यामुळे तुमचा स्वतःचा नेहमीचा Chrome बंद होत नाही.
      runSh(`pgrep -f "browser-profiles/shared" 2>/dev/null`);

  const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
  if (!pids.length) {
    console.log("  असे कोणतेही Chrome process सापडले नाही.");
    return;
  }
  killPids(pids, "automation चा Chrome");
}

const PORT = process.env.PORT || 5959;
killPort(PORT);
killOrphanedChrome();
console.log("\nसाफ झाले. आता 'npm run server' पुन्हा सुरू करू शकता.");
