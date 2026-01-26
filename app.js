const API_BASE = "/api";

let network = null; // Global Vis.js instance reference

// ==========================================
// UTILITIES: UI & ERROR HANDLING
// ==========================================
function showToast(message, isError = true) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : 'success'}`;
  toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-triangle' : 'fa-check-circle'}"></i>${message}`;
  container.appendChild(toast);
  // Smooth removal after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

// ==========================================
// 1. STACK SERVICE (C)
// ==========================================
async function fetchStack() {
  try {
    const resp = await fetch(`${API_BASE}/stack/data`);

    if (!resp.ok) throw new Error(`Stack Status: ${resp.status}`);
    const data = await resp.json();
    const display = document.getElementById('stack-data');
    if (Array.isArray(data) && data.length > 0) {
      // Renders with 'stack-item' class for CSS slide-in animations
      display.innerHTML = data.map(n => `<div class="stack-item">${n}</div>`).join('');
    } else {
      display.innerHTML = '<div class="empty-msg" style="color: #64748b; text-align: center; padding: 10px;">Stack is empty</div>';
    }
  } catch (e) {
    console.error('Stack Fetch Error:', e);
  }
}

async function refreshBackendVersion() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    const v = await r.json();
    document.getElementById("backend-version").textContent =
      `Backend: ${v.build_sha} (${v.build_time_utc})`;
  } catch (e) {
    document.getElementById("backend-version").textContent = "Backend: unavailable";
  }
}

setInterval(refreshBackendVersion, 3000);

async function refreshDevOps() {
  const r = await fetch("/api/devops", { cache: "no-store" });
  const d = await r.json();
  document.getElementById("devops-version").textContent =
    `DevOps: ${d.devops_sha} @ ${d.applied_at_utc}`;
}

async function refreshFrontendVersion() {
  try {
    const r = await fetch("/api/frontend-version", { cache: "no-store" });
    if (!r.ok) throw new Error("Frontend Version " + r.status);
    const v = await r.json();
    document.getElementById("frontend-version").textContent =
      `Frontend v.${v.buildsha} @ ${v.buildtimeutc}`;
  } catch (e) {
    console.error("Frontend Version Error:", e);
    document.getElementById("frontend-version").textContent =
      "Frontend unavailable";
  }
}

async function pushStack() {
  const input = document.getElementById('stack-input');
  const val = input.value;
  if (!val) return;
  try {
    // FIX: Send as JSON but ensure the 'value' is an integer for the Gateway
    const resp = await fetch(`${API_BASE}/stack/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: parseInt(val) })
    });
    if (!resp.ok) throw new Error();
    input.value = '';
    // Small timeout ensures the DB write is finished before the next fetch
    setTimeout(fetchStack, 150);
  } catch (e) {
    showToast('Stack Push Failed', true);
  }
}

async function popStack() {
  try {
    // FIX: Match the expected POST method in the Gateway
    const resp = await fetch(`${API_BASE}/stack/pop`, { method: 'POST' });
    if (!resp.ok) throw new Error();
    setTimeout(fetchStack, 150);
  } catch (e) {
    showToast('Stack Pop Failed', true);
  }
}

// ==========================================
// 2. LINKED LIST SERVICE (Java)
// ==========================================
async function fetchList() {
  try {
    const resp = await fetch(`${API_BASE}/list/data`);

    if (!resp.ok) throw new Error(`List Status: ${resp.status}`);
    const data = await resp.json();
    const display = document.getElementById('list-data');
    if (!Array.isArray(data) || data.length === 0) {
      display.innerHTML = '<span class="empty-msg" style="color: #64748b;">List is Empty</span>';
      return;
    }
    // Map nodes to chip elements connected by FontAwesome arrows
    display.innerHTML = data.map(node =>
      `<span class="node-chip">${node}</span>`
    ).join('<i class="fas fa-long-arrow-alt-right arrow"></i>');
  } catch (e) {
    console.error('List Fetch Error:', e);
  }
}

async function addList() {
  const input = document.getElementById('list-input');
  const val = input.value;
  if (!val) return;
  try {
    const resp = await fetch(`${API_BASE}/list/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: val })
    });
    if (!resp.ok) throw new Error();
    input.value = '';
    fetchList();
  } catch (e) {
    showToast('List Add Failed', true);
  }
}

async function delListTail() {
  try {
    const resp = await fetch(`${API_BASE}/list/delete`, { method: 'POST' });
    if (!resp.ok) throw new Error();
    fetchList();
  } catch (e) {
    showToast('Delete Tail Failed', true);
  }
}

async function delListHead() {
  try {
    const resp = await fetch(`${API_BASE}/list/remove-head`, { method: "POST" });
    if (!resp.ok) throw new Error();
    fetchList();
  } catch (e) {
    showToast('Delete Head Failed', true);
  }
}

// ==========================================
// 3. GRAPH SERVICE (Python + Vis.js)
// ==========================================
function getCurrentNodeIds() {
  if (!network) return [];
  return network.body.data.nodes.getIds();
}

async function fetchGraph() {
  try {
    const resp = await fetch(`${API_BASE}/graph/data`);

    if (!resp.ok) throw new Error();
    const data = await resp.json();

    const nodeData = (data.nodes || [])
      .filter(n => n != null)
      .map(node => {
        const idValue = typeof node === "object" ? (node.id ?? node.label ?? node) : node;
        const cleanId = String(idValue).trim().toUpperCase();

        return {
          id: cleanId,
          label: cleanId,
          color: { background: '#0ea5e9', border: '#38bdf8' },
          font: { color: '#ffffff', size: 14, face: 'Inter' },
          shadow: true,
          shape: 'ellipse'
        };
      });

    // Match the list-of-lists format from Python: [[source, target]]
    const edgeData = (data.edges || [])
      .map((edge, idx) => {
        if (!Array.isArray(edge) || edge.length < 2) return null;

        const cleanFrom = String(edge[0]).trim().toUpperCase();
        const cleanTo = String(edge[1]).trim().toUpperCase();

        return {
          id: `edge-${idx}`,
          from: cleanFrom,
          to: cleanTo,
          arrows: 'to',
          color: '#ef4444',
          width: 5
        };
      })
      .filter(e => e !== null);

    const container = document.getElementById('graph-data');
    if (network) network.destroy();

    network = new vis.Network(container, {
      nodes: new vis.DataSet(nodeData),
      edges: new vis.DataSet(edgeData)
    }, {
      physics: { enabled: true, barnesHut: { gravitationalConstant: -2000, springLength: 150 } },
      edges: { smooth: { enabled: true, type: 'continuous' } },
      interaction: { hover: true, dragNodes: true }
    });
  } catch (e) { console.error('Graph Visualization Error:', e); }
}

async function addGraphNode() {
  const input = document.getElementById('node-input');
  const raw = input.value;
  if (!raw) return;

  const label = raw.trim().toUpperCase();
  try {
    const resp = await fetch(`${API_BASE}/graph/add-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    if (!resp.ok) throw new Error();
    input.value = '';
    fetchGraph();
  } catch (e) {
    showToast('Add Node Failed', true);
  }
}

async function addGraphEdge() {
  const fromInput = document.getElementById('edge-from');
  const toInput = document.getElementById('edge-to');
  const uRaw = fromInput.value;
  const vRaw = toInput.value;
  if (!uRaw || !vRaw) return;

  const u = uRaw.trim().toUpperCase();
  const v = vRaw.trim().toUpperCase();

  const ids = getCurrentNodeIds();
  if (!ids.includes(u)) {
    showToast(`Node "${uRaw}" does not exist`, true);
    return;
  }
  if (!ids.includes(v)) {
    showToast(`Node "${vRaw}" does not exist`, true);
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/graph/add-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: u, to: v })
    });
    if (!resp.ok) throw new Error();
    fromInput.value = '';
    toInput.value = '';
    fetchGraph();
  } catch (e) {
    showToast('Link Connection Failed', true);
  }
}

// ==========================================
// NEW: GRAPH DELETION METHODS
// ==========================================

async function deleteGraphNode() {
  const input = document.getElementById('node-del-input');
  if (!input || !input.value) return;

  const label = input.value.trim().toUpperCase();
  try {
    const resp = await fetch(`${API_BASE}/graph/delete-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    if (!resp.ok) throw new Error();
    input.value = '';
    fetchGraph();
  } catch (e) {
    showToast('Delete Node Failed', true);
  }
}

async function deleteGraphEdge() {
  const fromInput = document.getElementById('edge-del-from');
  const toInput = document.getElementById('edge-del-to');
  if (!fromInput || !toInput || !fromInput.value || !toInput.value) return;

  const from = fromInput.value.trim().toUpperCase();
  const to = toInput.value.trim().toUpperCase();

  try {
    const resp = await fetch(`${API_BASE}/graph/delete-edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to })
    });
    if (!resp.ok) throw new Error();
    fromInput.value = '';
    toInput.value = '';
    fetchGraph();
  } catch (e) {
    showToast('Delete Edge Failed', true);
  }
}

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Initial data pull for all services
  fetchStack();
  fetchList();
  fetchGraph();

  setInterval(refreshBackendVersion, 3000);
  setInterval(refreshDevOps, 3000);
  setInterval(refreshFrontendVersion, 3000);
  refreshFrontendVersion();
  refreshBackendVersion();
  refreshDevOps();

  // Event Bindings: Stack
  document.getElementById('btn-push').onclick = pushStack;
  document.getElementById('btn-pop').onclick = popStack;

  // Event Bindings: Linked List
  document.getElementById('btn-list-add').onclick = addList;
  document.getElementById('btn-list-del').onclick = delListTail;
  document.getElementById('btn-list-head').onclick = delListHead;

  // Event Bindings: Graph
  document.getElementById('btn-add-node').onclick = addGraphNode;
  document.getElementById('btn-add-edge').onclick = addGraphEdge;

  // NEW: Graph Deletion Bindings
  const btnDelNode = document.getElementById('btn-del-node');
  if (btnDelNode) btnDelNode.onclick = deleteGraphNode;

  const btnDelEdge = document.getElementById('btn-del-edge');
  if (btnDelEdge) btnDelEdge.onclick = deleteGraphEdge;
});
