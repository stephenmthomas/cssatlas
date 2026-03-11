const UI = {
  scanBtn: document.getElementById("scanBtn"),
  copyJsonBtn: document.getElementById("copyJsonBtn"),
  classFilter: document.getElementById("classFilter"),
  propFilter: document.getElementById("propFilter"),
  classList: document.getElementById("classList"),
  pseudoList: document.getElementById("pseudoList"),
  propList: document.getElementById("propList"),
  statDom: document.getElementById("statDom"),
  statCss: document.getElementById("statCss"),
  statPseudo: document.getElementById("statPseudo"),
  statProps: document.getElementById("statProps"),
  status: document.getElementById("status"),
  tabBtns: [...document.querySelectorAll(".tabBtn")],
  tabPanels: [...document.querySelectorAll(".tabPanel")]
};

let LAST_RESULT = null;

UI.scanBtn.addEventListener("click", scanActiveTab);
UI.copyJsonBtn.addEventListener("click", copyJson);
UI.classFilter.addEventListener("input", renderAll);
UI.propFilter.addEventListener("input", renderAll);

UI.tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;

    UI.tabBtns.forEach(x => x.classList.toggle("is-active", x === btn));

    UI.tabPanels.forEach(panel => {
      const isActive = panel.dataset.panel === tab;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  });
});

async function scanActiveTab() {
  setStatus("Scanning...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab.");
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const domClasses = new Set();
        const cssClasses = new Set();
        const pseudoRules = new Set();
        const tokenDict = {};
        const selectorList = new Set();
        const cssVars = new Set();

        document.querySelectorAll("*").forEach(el => {
          el.classList.forEach(cls => domClasses.add(cls));
        });

        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              console.log("CSS Rule:", rule);
              if (!rule.selectorText || !rule.cssText) continue;

              selectorList.add(rule.selectorText);

              const classMatches = rule.selectorText.match(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g);
              if (classMatches) {
                classMatches.forEach(m => cssClasses.add(m.slice(1)));
              }

              if (rule.selectorText.includes(":")) {
                rule.selectorText.split(",").forEach(sel => {
                  const s = sel.trim();
                  const m = s.match(/\.([a-zA-Z_-][a-zA-Z0-9_-]*:{1,2}[a-zA-Z_-][a-zA-Z0-9_-]*)/);
                  if (m) {
                    const normalized = m[1]
                      .replace(":before", "::before")
                      .replace(":after", "::after");
                    pseudoRules.add(normalized);
                  }
                });
              }

              const open = rule.cssText.indexOf("{");
              const close = rule.cssText.lastIndexOf("}");
              if (open < 0 || close < 0 || close <= open) continue;

              const body = rule.cssText.slice(open + 1, close).trim();
              if (!body) continue;

              const decls = [];
              let cur = "";
              let depth = 0;

              for (const ch of body) {
                if (ch === "(") depth++;
                if (ch === ")") depth--;
                if (ch === ";" && depth === 0) {
                  if (cur.trim()) decls.push(cur.trim());
                  cur = "";
                } else {
                  cur += ch;
                }
              }
              if (cur.trim()) decls.push(cur.trim());

              for (const decl of decls) {
                const colon = decl.indexOf(":");
                if (colon < 0) continue;

                const prop = decl.slice(0, colon).trim();
                const value = decl.slice(colon + 1).trim();
                if (!prop || !value) continue;

                if (!tokenDict[prop]) tokenDict[prop] = [];
                if (!tokenDict[prop].includes(value)) {
                  tokenDict[prop].push(value);
                }

                const varMatches = value.match(/var\(--[a-zA-Z0-9_-]+\)/g);
                if (varMatches) {
                  varMatches.forEach(v => cssVars.add(v));
                }
              }
            }
          } catch {
            // inaccessible stylesheet; skip
          }
        }

        return {
          domClasses: [...domClasses].sort(),
          cssClasses: [...cssClasses].sort(),
          allClasses: [...new Set([...domClasses, ...cssClasses])].sort(),
          pseudoRules: [...pseudoRules].sort(),
          tokenDict: Object.fromEntries(
            Object.entries(tokenDict)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([k, vals]) => [k, vals.sort()])
          ),
          selectors: [...selectorList].sort(),
          cssVars: [...cssVars].sort()
        };
      }
    });

    LAST_RESULT = result;
    renderAll();
    setStatus("SCAN COMPLETE.");
  } catch (err) {
    console.error(err);
    setStatus("SCAN FAILED.");
  }
}

function renderAll() {
  const data = LAST_RESULT;

  if (!data) {
    UI.classList.innerHTML = `<div class="empty">No scan data.</div>`;
    UI.pseudoList.innerHTML = `<div class="empty">No scan data.</div>`;
    UI.propList.innerHTML = `<div class="empty">No scan data.</div>`;
    UI.statDom.textContent = "0";
    UI.statCss.textContent = "0";
    UI.statPseudo.textContent = "0";
    UI.statProps.textContent = "0";
    return;
  }

  UI.statDom.textContent = String(data.domClasses.length);
  UI.statCss.textContent = String(data.cssClasses.length);
  UI.statPseudo.textContent = String(data.pseudoRules.length);
  UI.statProps.textContent = String(Object.keys(data.tokenDict).length);

  const classNeedle = UI.classFilter.value.trim().toLowerCase();
  const propNeedle = UI.propFilter.value.trim().toLowerCase();

  const classItems = data.allClasses.filter(x => x.toLowerCase().includes(classNeedle));
  UI.classList.innerHTML = classItems.length
    ? classItems.map(x => `<div class="listItem">.${escapeHtml(x)}</div>`).join("")
    : `<div class="empty">No matching classes.</div>`;

  UI.pseudoList.innerHTML = data.pseudoRules.length
    ? data.pseudoRules.map(x => `<div class="listItem">.${escapeHtml(x)}</div>`).join("")
    : `<div class="empty">No pseudo selectors found.</div>`;

  const propEntries = Object.entries(data.tokenDict)
    .filter(([prop]) => prop.toLowerCase().includes(propNeedle))
    .sort((a, b) => b[1].length - a[1].length);

  UI.propList.innerHTML = propEntries.length
    ? propEntries.map(([prop, values]) => `
        <div class="propCard">
          <div class="propCard__title">${escapeHtml(prop)}</div>
          <div class="meta">${values.length} value(s)</div>
          <div class="propCard__values">
            ${values.map(v => `<span class="valueChip">${escapeHtml(v)}</span>`).join("")}
          </div>
        </div>
      `).join("")
    : `<div class="empty">No matching properties.</div>`;
}

async function copyJson() {
  if (!LAST_RESULT) {
    setStatus("Nothing to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(LAST_RESULT, null, 2));
    setStatus("JSON copied.");
  } catch (err) {
    console.error(err);
    setStatus("Copy failed.");
  }
}

function setStatus(msg) {
  UI.status.textContent = msg;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

renderAll();