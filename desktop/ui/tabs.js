const tabs = document.querySelector("#tabs");
const newTab = document.querySelector("#new-tab");
const changeHost = document.querySelector("#change-host");

function render(items) {
  tabs.replaceChildren();
  for (const item of items) {
    const tab = document.createElement("div");
    tab.className = item.active ? "tab active" : "tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", item.active ? "true" : "false");

    const title = document.createElement("button");
    title.type = "button";
    title.className = "title";
    title.textContent = item.title || "Vay Tutor";
    title.addEventListener("click", () => window.vay.selectTab(item.id));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.textContent = "×";
    close.disabled = items.length < 2;
    close.setAttribute("aria-label", `Close ${item.title || "tab"}`);
    close.addEventListener("click", () => window.vay.closeTab(item.id));

    tab.append(title, close);
    tabs.append(tab);
  }
}

newTab.addEventListener("click", () => window.vay.newTab());
changeHost.addEventListener("click", () => window.vay.changeHost());
window.vay.onTabs(render);
window.vay.listTabs().then(render);
