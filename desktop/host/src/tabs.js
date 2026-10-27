const MAX_TABS = 12;

function createTabs() {
  const items = [];
  let activeId = null;
  let sequence = 0;

  function snapshot() {
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      active: item.id === activeId,
    }));
  }

  return {
    get activeId() {
      return activeId;
    },
    get length() {
      return items.length;
    },
    snapshot,
    open(url) {
      if (items.length >= MAX_TABS) return null;
      sequence += 1;
      const item = { id: String(sequence), title: "Opening…", url };
      items.push(item);
      activeId = item.id;
      return item;
    },
    close(id) {
      if (items.length <= 1) return false;
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return false;
      items.splice(index, 1);
      if (activeId === id) {
        activeId = items[Math.min(index, items.length - 1)].id;
      }
      return true;
    },
    select(id) {
      if (!items.some((item) => item.id === id)) return false;
      activeId = id;
      return true;
    },
    cycle(backward) {
      if (items.length < 2) return activeId;
      const index = items.findIndex((item) => item.id === activeId);
      const next = backward
        ? (index - 1 + items.length) % items.length
        : (index + 1) % items.length;
      activeId = items[next].id;
      return activeId;
    },
    rename(id, title) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      const trimmed = String(title).trim();
      item.title = trimmed || "Vay Tutor";
    },
    clear() {
      items.splice(0, items.length);
      activeId = null;
    },
  };
}

module.exports = { MAX_TABS, createTabs };
