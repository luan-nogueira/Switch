import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

/* =========================================================
   FIREBASE
========================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyCeiZSLoTFyGEyOFTLcH4FCPJI_-YV8pmM",
  authDomain: "switchs-f8ca3.firebaseapp.com",
  projectId: "switchs-f8ca3",
  storageBucket: "switchs-f8ca3.firebasestorage.app",
  messagingSenderId: "24056268906",
  appId: "1:24056268906:web:d07426f51252c20d95e213"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* =========================================================
   APP STATE
========================================================= */
let switches = JSON.parse(localStorage.getItem("switchMappingDataV2")) || [];
let editingSwitchId = null;
let editingPortIndex = null;

const authScreen = document.getElementById("authScreen");
const appContainer = document.getElementById("appContainer");
const authForm = document.getElementById("authForm");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authMessage = document.getElementById("authMessage");
const loggedUser = document.getElementById("loggedUser");

/* =========================================================
   AUTH UI
========================================================= */
function setAuthMessage(message, isError = true) {
  authMessage.textContent = message;
  authMessage.className = isError ? "auth-message error" : "auth-message success";
}

function clearAuthMessage() {
  authMessage.textContent = "";
  authMessage.className = "auth-message";
}

function showApp(user) {
  authScreen.classList.add("hidden");
  appContainer.classList.remove("hidden");
  loggedUser.textContent = user?.email || "Usuário autenticado";
  renderSwitches();
  updateStats();
}

function showLogin() {
  appContainer.classList.add("hidden");
  authScreen.classList.remove("hidden");
}

function translateFirebaseError(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "Email inválido.";
    case "auth/user-disabled":
      return "Este usuário foi desativado.";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "Email ou senha incorretos.";
    case "auth/wrong-password":
      return "Senha incorreta.";
    case "auth/email-already-in-use":
      return "Este email já está em uso.";
    case "auth/weak-password":
      return "A senha é muito fraca. Use uma senha mais forte.";
    case "auth/missing-password":
      return "Digite a senha.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Tente novamente em alguns minutos.";
    case "auth/network-request-failed":
      return "Erro de rede. Verifique sua conexão.";
    default:
      return error?.message || "Ocorreu um erro na autenticação.";
  }
}

/* =========================================================
   AUTH EVENTS
========================================================= */
authForm.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearAuthMessage();

  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  if (!email || !password) {
    setAuthMessage("Preencha email e senha.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setAuthMessage("Login realizado com sucesso!", false);
    authForm.reset();
  } catch (error) {
    setAuthMessage(translateFirebaseError(error), true);
  }
});

registerBtn.addEventListener("click", async function () {
  clearAuthMessage();

  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  if (!email || !password) {
    setAuthMessage("Preencha email e senha para criar a conta.");
    return;
  }

  if (password.length < 6) {
    setAuthMessage("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    setAuthMessage("Conta criada com sucesso!", false);
    authForm.reset();
  } catch (error) {
    setAuthMessage(translateFirebaseError(error), true);
  }
});

logoutBtn.addEventListener("click", async function () {
  try {
    await signOut(auth);
  } catch (error) {
    alert("Erro ao sair: " + translateFirebaseError(error));
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    showApp(user);
  } else {
    showLogin();
  }
});

/* =========================================================
   DADOS
========================================================= */
function saveData() {
  localStorage.setItem("switchMappingDataV2", JSON.stringify(switches));
}

function generateId() {
  return Date.now().toString() + Math.random().toString(16).slice(2);
}

function createPorts(total) {
  const ports = [];

  for (let i = 1; i <= total; i++) {
    ports.push({
      number: i,
      device: "",
      status: "inativo",
      ip: "",
      sector: "",
      obs: ""
    });
  }

  return ports;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateStats() {
  const totalSwitches = switches.length;
  const totalPorts = switches.reduce((acc, sw) => acc + sw.ports.length, 0);

  const usedPorts = switches.reduce((acc, sw) => {
    return acc + sw.ports.filter(port => port.device.trim() !== "" && port.status === "ativo").length;
  }, 0);

  const freePorts = totalPorts - usedPorts;

  document.getElementById("statSwitches").textContent = totalSwitches;
  document.getElementById("statPorts").textContent = totalPorts;
  document.getElementById("statUsed").textContent = usedPorts;
  document.getElementById("statFree").textContent = freePorts;
}

function getStatusClass(status) {
  if (status === "ativo") return "status-ativo";
  if (status === "reserva") return "status-reserva";
  return "status-inativo";
}

window.toggleSwitch = function (id) {
  const sw = switches.find(item => item.id === id);
  if (!sw) return;

  sw.expanded = !sw.expanded;
  saveData();
  renderSwitches();
};

function renderSwitches() {
  const container = document.getElementById("switchesContainer");
  const search = document.getElementById("searchInput").value.trim().toLowerCase();

  const filtered = switches.filter(sw => {
    const fullText = [
      sw.name,
      sw.location,
      sw.model,
      sw.obs,
      ...sw.ports.map(port => `${port.number} ${port.device} ${port.status} ${port.ip} ${port.sector} ${port.obs}`)
    ].join(" ").toLowerCase();

    return fullText.includes(search);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Nenhum switch encontrado</h3>
        <p>Cadastre um switch ou ajuste o texto da busca.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(sw => {
    const usedCount = sw.ports.filter(port => port.device.trim() !== "").length;

    return `
      <div class="switch-card">
        <div class="switch-header" onclick="toggleSwitch('${sw.id}')">
          <div class="switch-left">
            <div class="toggle-arrow ${sw.expanded ? "open" : ""}">⌄</div>

            <div class="switch-info">
              <h3>${escapeHtml(sw.name)}</h3>
              <p>
                Local: ${escapeHtml(sw.location || "Não informado")} |
                Modelo: ${escapeHtml(sw.model || "Não informado")} |
                Portas: ${sw.portsCount} |
                Cadastradas: ${usedCount}
              </p>
              ${sw.obs ? `<p>Obs: ${escapeHtml(sw.obs)}</p>` : ""}
            </div>
          </div>

          <div class="switch-actions" onclick="event.stopPropagation()">
            <button class="btn btn-outline" onclick="editSwitch('${sw.id}')">Editar switch</button>
            <button class="btn btn-danger" onclick="deleteSwitch('${sw.id}')">Excluir</button>
          </div>
        </div>

        <div class="switch-body ${sw.expanded ? "open" : ""}">
          <div class="ports-grid">
            ${sw.ports.map((port, index) => `
              <div class="port-card">
                <div class="port-top">
                  <div class="port-number">Porta ${port.number}</div>
                  <span class="status-badge ${getStatusClass(port.status)}">${escapeHtml(port.status)}</span>
                </div>

                <div class="port-device ${port.device ? "" : "empty"}">
                  ${port.device ? escapeHtml(port.device) : "Nenhum dispositivo informado"}
                </div>

                <div class="port-details">
                  <div><strong>Setor:</strong> ${escapeHtml(port.sector || "-")}</div>
                  <div><strong>IP/VLAN:</strong> ${escapeHtml(port.ip || "-")}</div>
                  <div><strong>Obs:</strong> ${escapeHtml(port.obs || "-")}</div>
                </div>

                <div class="port-actions">
                  <button class="btn btn-primary" onclick="openPortModal('${sw.id}', ${index})">Editar</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

window.editSwitch = function (id) {
  const sw = switches.find(item => item.id === id);
  if (!sw) return;

  const newName = prompt("Novo nome do switch:", sw.name);
  if (newName === null) return;

  const newLocation = prompt("Novo local do switch:", sw.location || "");
  if (newLocation === null) return;

  const newModel = prompt("Novo modelo do switch:", sw.model || "");
  if (newModel === null) return;

  const newObs = prompt("Nova observação do switch:", sw.obs || "");
  if (newObs === null) return;

  sw.name = newName.trim() || sw.name;
  sw.location = newLocation.trim();
  sw.model = newModel.trim();
  sw.obs = newObs.trim();

  saveData();
  renderSwitches();
  updateStats();
};

window.deleteSwitch = function (id) {
  const sw = switches.find(item => item.id === id);
  if (!sw) return;

  const confirmed = confirm(`Deseja realmente excluir o switch "${sw.name}"?`);
  if (!confirmed) return;

  switches = switches.filter(item => item.id !== id);
  saveData();
  renderSwitches();
  updateStats();
};

window.openPortModal = function (switchId, portIndex) {
  editingSwitchId = switchId;
  editingPortIndex = portIndex;

  const sw = switches.find(item => item.id === switchId);
  if (!sw) return;

  const port = sw.ports[portIndex];
  if (!port) return;

  document.getElementById("modalTitle").textContent = `${sw.name} - Porta ${port.number}`;
  document.getElementById("portDevice").value = port.device || "";
  document.getElementById("portStatus").value = port.status || "inativo";
  document.getElementById("portIp").value = port.ip || "";
  document.getElementById("portSector").value = port.sector || "";
  document.getElementById("portObs").value = port.obs || "";

  document.getElementById("portModal").classList.add("show");
};

window.closeModal = function () {
  document.getElementById("portModal").classList.remove("show");
  editingSwitchId = null;
  editingPortIndex = null;
  document.getElementById("portForm").reset();
};

window.clearPortData = function () {
  document.getElementById("portDevice").value = "";
  document.getElementById("portStatus").value = "inativo";
  document.getElementById("portIp").value = "";
  document.getElementById("portSector").value = "";
  document.getElementById("portObs").value = "";
};

document.getElementById("switchForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const name = document.getElementById("switchName").value.trim();
  const location = document.getElementById("switchLocation").value.trim();
  const portsCount = parseInt(document.getElementById("switchPorts").value, 10);
  const model = document.getElementById("switchModel").value.trim();
  const obs = document.getElementById("switchObs").value.trim();

  if (!name) {
    alert("Informe o nome do switch.");
    return;
  }

  switches.unshift({
    id: generateId(),
    name,
    location,
    portsCount,
    model,
    obs,
    expanded: false,
    ports: createPorts(portsCount),
    createdAt: new Date().toLocaleString("pt-BR")
  });

  saveData();
  this.reset();
  document.getElementById("switchPorts").value = "24";
  renderSwitches();
  updateStats();
});

document.getElementById("portForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const sw = switches.find(item => item.id === editingSwitchId);
  if (!sw) return;

  const port = sw.ports[editingPortIndex];
  if (!port) return;

  port.device = document.getElementById("portDevice").value.trim();
  port.status = document.getElementById("portStatus").value;
  port.ip = document.getElementById("portIp").value.trim();
  port.sector = document.getElementById("portSector").value.trim();
  port.obs = document.getElementById("portObs").value.trim();

  saveData();
  renderSwitches();
  updateStats();
  closeModal();
});

window.exportData = function () {
  const blob = new Blob([JSON.stringify(switches, null, 2)], { type: "application/json" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = "backup_switches_profissional_v2.json";
  link.click();

  URL.revokeObjectURL(link.href);
};

window.importData = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);

      if (!Array.isArray(data)) {
        alert("Arquivo inválido.");
        return;
      }

      const confirmed = confirm("Importar esse backup substituirá os dados atuais. Deseja continuar?");
      if (!confirmed) return;

      switches = data.map(sw => ({
        ...sw,
        expanded: false
      }));

      saveData();
      renderSwitches();
      updateStats();
      alert("Backup importado com sucesso!");
    } catch (error) {
      alert("Erro ao importar o arquivo JSON.");
    } finally {
      event.target.value = "";
    }
  };

  reader.readAsText(file);
};

document.getElementById("portModal").addEventListener("click", function (e) {
  if (e.target.id === "portModal") {
    closeModal();
  }
});

renderSwitches();
updateStats();
