const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
const tablePath = path.join(dataDir, "monitors.json");

function initDb() {
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(tablePath)) {
    fs.writeFileSync(tablePath, JSON.stringify({ monitors: [] }, null, 2), "utf8");
  }

  function loadTable() {
    const raw = fs.readFileSync(tablePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.monitors) ? parsed.monitors : [];
  }

  function saveTable(monitors) {
    const tmp = `${tablePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ monitors }, null, 2), "utf8");
    fs.renameSync(tmp, tablePath);
  }

  return {
    getAllMonitors() {
      return loadTable();
    },

    getMonitorById(id) {
      return loadTable().find((m) => m.id === id) || null;
    },

    insertMonitor(monitor) {
      const monitors = loadTable();
      monitors.push(monitor);
      saveTable(monitors);
    },

    updateMonitor(id, patcher) {
      const monitors = loadTable();
      const idx = monitors.findIndex((m) => m.id === id);
      if (idx === -1) return false;
      const next = patcher(monitors[idx]);
      monitors[idx] = next;
      saveTable(monitors);
      return true;
    },
  };
}

module.exports = { initDb };

