import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  addDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";

/* =========================================================
   FIREBASE
========================================================= */
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_STORAGE_BUCKET",
  messagingSenderId: "SEU_MESSAGING_SENDER_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "southamerica-east1");

/* =========================================================
   CALLABLE FUNCTIONS
========================================================= */
const fnCreateManagedUser = httpsCallable(functions, "createManagedUser");
const fnUpdateManagedUser = httpsCallable(functions, "updateManagedUser");
const fnDeleteManagedUser = httpsCallable(functions, "deleteManagedUser");
const fnResetManagedUserPassword = httpsCallable(functions, "resetManagedUserPassword");

/* =========================================================
   HELPERS
========================================================= */
const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function getStatusClass(status) {
  if (status === "ativo") return "status-ativo";
  if (status === "reserva") return "status-reserva";
  return "status-inativo";
}

function formatContractId(id) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  return raw
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeContractId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function setMessage(id, message, isError = true) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = isError ? "auth-message error" : "auth-message success";
}

function clearMessage(id) {
  const el = $(id);
  if (!el) return;
  el.textContent = "";
  el.className = "auth-message";
}

function hideAllScreens() {
  $("authScreen")?.classList.add("hidden");
  $("changePasswordScreen")?.classList.add("hidden");
  $("appContainer")?.classList.add("hidden");
}

function showLogin() {
  hideAllScreens();
  $("authScreen")?.classList.remove("hidden");
}

function showChangePasswordScreen() {
  hideAllScreens();
  $("changePasswordScreen")?.classList.remove("hidden");
}

function showApp() {
  hideAllScreens();
  $("appContainer")?.classList.remove("hidden");
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
    case "auth/weak-password":
      return "A senha é muito fraca.";
    case "auth/missing-password":
      return "Digite a senha.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Tente novamente em alguns minutos.";
    case "auth/network-request-failed":
      return "Erro de rede. Verifique sua conexão.";
    case "auth/requires-recent-login":
      return "Faça login novamente para alterar a senha.";
    default:
      return error?.message || "Ocorreu um erro.";
  }
}

function translateCallableError(error) {
  const message = error?.message || "";

  if (message.includes("permission-denied")) return "Você não tem permissão para essa ação.";
  if (message.includes("already-exists")) return "Já existe um usuário com esse email.";
  if (message.includes("invalid-argument")) return "Dados inválidos. Revise os campos.";
  if (message.includes("not-found")) return "Registro não encontrado.";
  return message || "Erro ao processar a ação.";
}

function isValidIpOrHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;

  const noProtocol = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

  const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

  const hostnameRegex =
    /^(localhost|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+)$/;

  return ipv4Regex.test(noProtocol) || hostnameRegex.test(noProtocol);
}

function normalizeSwitchUrl(ip) {
  const value = String(ip || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

/* =========================================================
   ESTADO
========================================================= */
let currentUser = null;
let currentUserProfile = null;
let currentContractId = "";
let currentContractNameMap = {};
let switches = [];
let users = [];
let contracts = [];
let editingSwitchId = null;
let editingPortIndex = null;
let switchEditingId = null;
let editingUserId = null;
let unsubscribeUserProfile = null;
let unsubscribeSwitches = null;
let unsubscribeUsers = null;
let unsubscribeContracts = null;
let expandedState = {};

/* =========================================================
   LISTENERS CLEANUP
========================================================= */
function cleanupListeners() {
  if (unsubscribeUserProfile) {
    unsubscribeUserProfile();
    unsubscribeUserProfile = null;
  }

  if (unsubscribeSwitches) {
    unsubscribeSwitches();
    unsubscribeSwitches = null;
  }

  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }

  if (unsubscribeContracts) {
    unsubscribeContracts();
    unsubscribeContracts = null;
  }
}

/* =========================================================
   CONTRATOS
========================================================= */
async function loadContractNames(contractIds) {
  const map = {};
  await Promise.all(
    contractIds.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "contracts", id));
        if (snap.exists()) {
          map[id] = snap.data().name || formatContractId(id);
        } else {
          map[id] = formatContractId(id);
        }
      } catch {
        map[id] = formatContractId(id);
      }
    })
  );
  currentContractNameMap = map;
}

function renderContractOptions() {
  const contractSelect = $("contractSelect");
  if (!contractSelect) return;

  const allowedContracts = Array.isArray(currentUserProfile?.contracts)
    ? currentUserProfile.contracts
    : [];

  if (!allowedContracts.length) {
    contractSelect.innerHTML = `<option value="">Nenhum contrato liberado</option>`;
    contractSelect.disabled = true;
    return;
  }

  contractSelect.disabled = false;
  contractSelect.innerHTML = allowedContracts.map((contractId) => {
    const name = currentContractNameMap[contractId] || formatContractId(contractId);
    return `<option value="${escapeHtml(contractId)}">${escapeHtml(name)}</option>`;
  }).join("");

  contractSelect.value = currentContractId;
}

function ensureAllowedContract() {
  const allowedContracts = Array.isArray(currentUserProfile?.contracts)
    ? currentUserProfile.contracts
    : [];

  if (!allowedContracts.length) {
    currentContractId = "";
    switches = [];
    renderContractOptions();
    renderSwitches();
    updateStats();
    return false;
  }

  if (!allowedContracts.includes(currentContractId)) {
    currentContractId = allowedContracts[0];
  }

  renderContractOptions();
  return true;
}

function buildContractsChecksHtml(list, selectedContracts = []) {
  if (!list.length) {
    return `<p class="auth-message error">Nenhum contrato cadastrado.</p>`;
  }

  return list.map(contract => `
    <label>
      <input
        type="checkbox"
        value="${escapeHtml(contract.id)}"
        ${selectedContracts.includes(contract.id) ? "checked" : ""}
      >
      ${escapeHtml(contract.name || formatContractId(contract.id))}
    </label>
  `).join("");
}

function getCheckedValues(containerId) {
  const container = $(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.value);
}

function renderAdminContractsChecks() {
  const html = buildContractsChecksHtml(contracts, []);
  if ($("adminContractsChecks")) $("adminContractsChecks").innerHTML = html;
}

function renderEditContractsChecks(selectedContracts = []) {
  const html = buildContractsChecksHtml(contracts, selectedContracts);
  if ($("editContractsChecks")) $("editContractsChecks").innerHTML = html;
}

function renderContractsList() {
  const list = $("contractsList");
  if (!list) return;

  if (!contracts.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Nenhum contrato</h3>
        <p>Cadastre o primeiro contrato.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = contracts.map(contract => `
    <div class="admin-card">
      <h5>${escapeHtml(contract.name || formatContractId(contract.id))}</h5>
      <p><strong>ID:</strong> ${escapeHtml(contract.id)}</p>
      <div class="actions-row">
        <button class="btn btn-danger" onclick="deleteContract('${contract.id}')">Excluir</button>
      </div>
    </div>
  `).join("");
}

function subscribeContracts() {
  const q = query(collection(db, "contracts"), orderBy("name"));
  unsubscribeContracts = onSnapshot(q, (snapshot) => {
    contracts = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    renderContractsList();
    renderAdminContractsChecks();
    renderEditContractsChecks(editingUserId ? (users.find(u => u.id === editingUserId)?.contracts || []) : []);
  });
}

/* =========================================================
   PERFIL DO USUÁRIO
========================================================= */
function subscribeUserProfile(uid) {
  const userRef = doc(db, "users", uid);

  unsubscribeUserProfile = onSnapshot(userRef, async (snap) => {
    if (!snap.exists()) {
      alert("Seu usuário autenticou, mas não existe cadastro em /users/{uid} no Firestore.");
      await signOut(auth);
      return;
    }

    currentUserProfile = {
      id: snap.id,
      ...snap.data()
    };

    const loggedUser = $("loggedUser");
    if (loggedUser) {
      loggedUser.textContent = currentUserProfile?.name
        ? `${currentUserProfile.name} (${currentUserProfile.email || currentUser?.email || ""})`
        : (currentUser?.email || "Usuário autenticado");
    }

    const allowedContracts = Array.isArray(currentUserProfile.contracts)
      ? currentUserProfile.contracts
      : [];

    await loadContractNames(allowedContracts);

    if (currentUserProfile.mustChangePassword === true) {
      showChangePasswordScreen();
      return;
    }

    showApp();

    const ok = ensureAllowedContract();
    if (ok) subscribeSwitches(currentContractId);

    if (isCurrentUserAdmin()) {
      subscribeUsers();
      subscribeContracts();
    }
  });
}

/* =========================================================
   USUÁRIOS
========================================================= */
function subscribeUsers() {
  if (unsubscribeUsers) {
    unsubscribeUsers();
    unsubscribeUsers = null;
  }

  const q = query(collection(db, "users"), orderBy("name"));
  unsubscribeUsers = onSnapshot(q, (snapshot) => {
    users = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    renderUsersList();
  });
}

function renderUsersList() {
  const list = $("usersList");
  if (!list) return;

  if (!users.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Nenhum usuário</h3>
        <p>Cadastre o primeiro usuário.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = users.map(user => {
    const userContracts = Array.isArray(user.contracts) ? user.contracts : [];
    return `
      <div class="admin-card">
        <h5>${escapeHtml(user.name || "Sem nome")}</h5>
        <p><strong>Email:</strong> ${escapeHtml(user.email || "-")}</p>
        <p>
          <span class="badge-inline ${user.isAdmin ? "badge-admin" : "badge-user"}">
            ${user.isAdmin ? "Administrador" : "Usuário"}
          </span>
        </p>
        <p><strong>Troca senha no login:</strong> ${user.mustChangePassword ? "Sim" : "Não"}</p>
        <p>
          <strong>Contratos:</strong><br>
          ${userContracts.length
            ? userContracts.map(contractId => `
                <span class="badge-inline badge-contract">
                  ${escapeHtml(getContractName(contractId))}
                </span>
              `).join("")
            : "Nenhum"}
        </p>
        <div class="actions-row">
          <button class="btn btn-outline" onclick="openEditUserModal('${user.id}')">Editar</button>
          <button class="btn btn-danger" onclick="removeUser('${user.id}')">Excluir</button>
        </div>
      </div>
    `;
  }).join("");
}

function getContractName(contractId) {
  const contract = contracts.find(item => item.id === contractId);
  return contract?.name || currentContractNameMap[contractId] || formatContractId(contractId);
}

/* =========================================================
   SWITCHES EM TEMPO REAL
========================================================= */
function subscribeSwitches(contractId) {
  if (!contractId) {
    switches = [];
    renderSwitches();
    updateStats();
    return;
  }

  if (unsubscribeSwitches) {
    unsubscribeSwitches();
    unsubscribeSwitches = null;
  }

  const q = query(
    collection(db, "contracts", contractId, "switches"),
    orderBy("name")
  );

  unsubscribeSwitches = onSnapshot(
    q,
    (snapshot) => {
      switches = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        expanded: !!expandedState[docSnap.id]
      }));

      renderSwitches();
      updateStats();
    },
    (error) => {
      console.error(error);
      alert("Erro ao carregar switches do contrato selecionado.");
    }
  );
}

/* =========================================================
   AUTH
========================================================= */
$("authForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearMessage("authMessage");

  const email = $("authEmail")?.value.trim() || "";
  const password = $("authPassword")?.value || "";

  if (!email || !password) {
    setMessage("authMessage", "Preencha email e senha.");
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    $("authForm")?.reset();
  } catch (error) {
    setMessage("authMessage", translateFirebaseError(error), true);
  }
});

$("logoutBtn")?.addEventListener("click", async function () {
  try {
    await signOut(auth);
  } catch (error) {
    alert("Erro ao sair: " + translateFirebaseError(error));
  }
});

$("changePasswordForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();
  clearMessage("changePasswordMessage");

  const newPassword = $("newPassword")?.value || "";
  const confirmPassword = $("confirmNewPassword")?.value || "";

  if (!newPassword || !confirmPassword) {
    setMessage("changePasswordMessage", "Preencha os dois campos.");
    return;
  }

  if (newPassword.length < 6) {
    setMessage("changePasswordMessage", "A nova senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  if (newPassword !== confirmPassword) {
    setMessage("changePasswordMessage", "As senhas não coincidem.");
    return;
  }

  try {
    await updatePassword(auth.currentUser, newPassword);

    if (currentUser?.uid) {
      await updateDoc(doc(db, "users", currentUser.uid), {
        mustChangePassword: false,
        updatedAt: serverTimestamp()
      });
    }

    $("changePasswordForm")?.reset();
    setMessage("changePasswordMessage", "Senha alterada com sucesso!", false);
    showApp();
  } catch (error) {
    setMessage("changePasswordMessage", translateFirebaseError(error), true);
  }
});

onAuthStateChanged(auth, (user) => {
  cleanupListeners();

  currentUser = user || null;
  currentUserProfile = null;
  currentContractId = "";
  currentContractNameMap = {};
  switches = [];
  users = [];
  contracts = [];
  expandedState = {};
  switchEditingId = null;
  editingSwitchId = null;
  editingPortIndex = null;
  editingUserId = null;

  if (user) {
    subscribeUserProfile(user.uid);
  } else {
    showLogin();
  }
});

/* =========================================================
   CONTRATO SELECT
========================================================= */
$("contractSelect")?.addEventListener("change", function () {
  currentContractId = this.value || "";

  if (!currentContractId) {
    switches = [];
    renderSwitches();
    updateStats();
    return;
  }

  subscribeSwitches(currentContractId);
});

/* =========================================================
   BUSCA
========================================================= */
$("searchInput")?.addEventListener("input", renderSwitches);

/* =========================================================
   RENDER SWITCHES
========================================================= */
function renderSwitches() {
  const container = $("switchesContainer");
  if (!container) return;

  const search = ($("searchInput")?.value || "").trim().toLowerCase();

  if (!currentContractId && currentUserProfile) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Nenhum contrato liberado</h3>
        <p>Seu usuário não possui contratos disponíveis no momento.</p>
      </div>
    `;
    return;
  }

  const filtered = switches.filter(sw => {
    const fullText = [
      sw.name,
      sw.location,
      sw.model,
      sw.ip,
      sw.obs,
      ...(Array.isArray(sw.ports)
        ? sw.ports.map(port => `${port.number} ${port.device} ${port.status} ${port.ip} ${port.sector} ${port.obs}`)
        : [])
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
    const ports = Array.isArray(sw.ports) ? sw.ports : [];
    const usedCount = ports.filter(port => String(port.device || "").trim() !== "").length;
    const switchIp = String(sw.ip || "").trim();
    const switchUrl = normalizeSwitchUrl(switchIp);

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
                IP: ${escapeHtml(switchIp || "Não informado")} |
                Portas: ${sw.portsCount || ports.length || 0} |
                Cadastradas: ${usedCount}
              </p>
              ${sw.obs ? `<p>Obs: ${escapeHtml(sw.obs)}</p>` : ""}
            </div>
          </div>

          <div class="switch-actions" onclick="event.stopPropagation()">
            ${
              switchIp
                ? `<a class="btn btn-web" href="${escapeHtml(switchUrl)}" target="_blank" rel="noopener noreferrer">Clique para ir para Web do switch</a>`
                : `<button class="btn btn-disabled" type="button" disabled>Sem IP cadastrado</button>`
            }
            <button class="btn btn-outline" onclick="editSwitch('${sw.id}')">Editar switch</button>
            <button class="btn btn-danger" onclick="deleteSwitch('${sw.id}')">Excluir</button>
          </div>
        </div>

        <div class="switch-body ${sw.expanded ? "open" : ""}">
          <div class="ports-grid">
            ${ports.map((port, index) => `
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

function updateStats() {
  const totalSwitches = switches.length;
  const totalPorts = switches.reduce((acc, sw) => acc + (Array.isArray(sw.ports) ? sw.ports.length : 0), 0);

  const usedPorts = switches.reduce((acc, sw) => {
    const ports = Array.isArray(sw.ports) ? sw.ports : [];
    return acc + ports.filter(port => String(port.device || "").trim() !== "" && port.status === "ativo").length;
  }, 0);

  const freePorts = totalPorts - usedPorts;

  if ($("statSwitches")) $("statSwitches").textContent = totalSwitches;
  if ($("statPorts")) $("statPorts").textContent = totalPorts;
  if ($("statUsed")) $("statUsed").textContent = usedPorts;
  if ($("statFree")) $("statFree").textContent = freePorts;
}

/* =========================================================
   SWITCH ACTIONS
========================================================= */
window.toggleSwitch = function (id) {
  expandedState[id] = !expandedState[id];
  switches = switches.map(sw => sw.id === id ? { ...sw, expanded: expandedState[id] } : sw);
  renderSwitches();
};

window.editSwitch = function (id) {
  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

  const sw = switches.find(item => item.id === id);
  if (!sw) return;

  switchEditingId = id;

  $("editSwitchName").value = sw.name || "";
  $("editSwitchLocation").value = sw.location || "";
  $("editSwitchModel").value = sw.model || "";
  $("editSwitchIp").value = sw.ip || "";
  $("editSwitchObs").value = sw.obs || "";

  $("editSwitchModal")?.classList.add("show");
};

window.closeEditSwitchModal = function () {
  $("editSwitchModal")?.classList.remove("show");
  $("editSwitchForm")?.reset();
  switchEditingId = null;
};

window.deleteSwitch = async function (id) {
  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

  const sw = switches.find(item => item.id === id);
  if (!sw) return;

  const confirmed = confirm(`Deseja realmente excluir o switch "${sw.name}"?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "contracts", currentContractId, "switches", id));
    delete expandedState[id];
  } catch (error) {
    console.error(error);
    alert("Erro ao excluir switch.");
  }
};

window.openPortModal = function (switchId, portIndex) {
  editingSwitchId = switchId;
  editingPortIndex = portIndex;

  const sw = switches.find(item => item.id === switchId);
  if (!sw) return;

  const port = Array.isArray(sw.ports) ? sw.ports[portIndex] : null;
  if (!port) return;

  $("modalTitle").textContent = `${sw.name} - Porta ${port.number}`;
  $("portDevice").value = port.device || "";
  $("portStatus").value = port.status || "inativo";
  $("portIp").value = port.ip || "";
  $("portSector").value = port.sector || "";
  $("portObs").value = port.obs || "";

  $("portModal")?.classList.add("show");
};

window.closeModal = function () {
  $("portModal")?.classList.remove("show");
  editingSwitchId = null;
  editingPortIndex = null;
  $("portForm")?.reset();
};

window.clearPortData = function () {
  $("portDevice").value = "";
  $("portStatus").value = "inativo";
  $("portIp").value = "";
  $("portSector").value = "";
  $("portObs").value = "";
};

/* =========================================================
   FORM SWITCH
========================================================= */
$("switchForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

  const name = $("switchName")?.value.trim() || "";
  const location = $("switchLocation")?.value.trim() || "";
  const portsCount = parseInt($("switchPorts")?.value || "24", 10);
  const model = $("switchModel")?.value.trim() || "";
  const ip = $("switchIp")?.value.trim() || "";
  const obs = $("switchObs")?.value.trim() || "";

  if (!name) {
    alert("Informe o nome do switch.");
    return;
  }

  if (!isValidIpOrHost(ip)) {
    alert("Informe um IP ou endereço válido para o switch.");
    return;
  }

  try {
    await addDoc(collection(db, "contracts", currentContractId, "switches"), {
      localId: generateId(),
      name,
      location,
      portsCount,
      model,
      ip,
      obs,
      expanded: false,
      ports: createPorts(portsCount),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    this.reset();
    $("switchPorts").value = "24";
  } catch (error) {
    console.error(error);
    alert("Erro ao salvar switch.");
  }
});

/* =========================================================
   FORM EDITAR SWITCH
========================================================= */
$("editSwitchForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

  if (!switchEditingId) {
    alert("Nenhum switch selecionado para edição.");
    return;
  }

  const sw = switches.find(item => item.id === switchEditingId);
  if (!sw) {
    alert("Switch não encontrado.");
    return;
  }

  const name = $("editSwitchName")?.value.trim() || "";
  const location = $("editSwitchLocation")?.value.trim() || "";
  const model = $("editSwitchModel")?.value.trim() || "";
  const ip = $("editSwitchIp")?.value.trim() || "";
  const obs = $("editSwitchObs")?.value.trim() || "";

  if (!name) {
    alert("Informe o nome do switch.");
    return;
  }

  if (!isValidIpOrHost(ip)) {
    alert("Informe um IP ou endereço válido para o switch.");
    return;
  }

  try {
    await updateDoc(doc(db, "contracts", currentContractId, "switches", switchEditingId), {
      name,
      location,
      model,
      ip,
      obs,
      updatedAt: serverTimestamp()
    });

    closeEditSwitchModal();
  } catch (error) {
    console.error(error);
    alert("Erro ao editar switch.");
  }
});

/* =========================================================
   FORM PORTA
========================================================= */
$("portForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

  const sw = switches.find(item => item.id === editingSwitchId);
  if (!sw) return;

  const updatedPorts = Array.isArray(sw.ports) ? [...sw.ports] : [];
  const port = updatedPorts[editingPortIndex];
  if (!port) return;

  port.device = $("portDevice")?.value.trim() || "";
  port.status = $("portStatus")?.value || "inativo";
  port.ip = $("portIp")?.value.trim() || "";
  port.sector = $("portSector")?.value.trim() || "";
  port.obs = $("portObs")?.value.trim() || "";

  try {
    await updateDoc(doc(db, "contracts", currentContractId, "switches", editingSwitchId), {
      ports: updatedPorts,
      updatedAt: serverTimestamp()
    });

    closeModal();
  } catch (error) {
    console.error(error);
    alert("Erro ao salvar porta.");
  }
});

/* =========================================================
   IMPORT / EXPORT
========================================================= */
$("exportBtn")?.addEventListener("click", exportData);
$("importBtn")?.addEventListener("click", () => $("importFile")?.click());
$("importFile")?.addEventListener("change", importData);

function exportData() {
  const payload = {
    contractId: currentContractId,
    contractName: currentContractNameMap[currentContractId] || currentContractId,
    exportedAt: new Date().toISOString(),
    switches
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `backup_${currentContractId || "contrato"}_switches.json`;
  link.click();

  URL.revokeObjectURL(link.href);
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!currentContractId) {
    alert("Selecione um contrato antes de importar.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const importedSwitches = Array.isArray(parsed) ? parsed : parsed.switches;

      if (!Array.isArray(importedSwitches)) {
        alert("Arquivo inválido.");
        return;
      }

      const confirmed = confirm(
        `Importar ${importedSwitches.length} switch(es) para o contrato "${currentContractNameMap[currentContractId] || currentContractId}"?`
      );
      if (!confirmed) return;

      const batch = writeBatch(db);

      for (const sw of importedSwitches) {
        const ref = doc(collection(db, "contracts", currentContractId, "switches"));
        batch.set(ref, {
          localId: generateId(),
          name: String(sw.name || "").trim(),
          location: String(sw.location || "").trim(),
          portsCount: Number(sw.portsCount || (Array.isArray(sw.ports) ? sw.ports.length : 24)),
          model: String(sw.model || "").trim(),
          ip: String(sw.ip || "").trim(),
          obs: String(sw.obs || "").trim(),
          expanded: false,
          ports: Array.isArray(sw.ports)
            ? sw.ports
            : createPorts(Number(sw.portsCount || 24)),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      await batch.commit();
      alert("Importação concluída com sucesso.");
    } catch (error) {
      console.error(error);
      alert("Erro ao importar o arquivo JSON.");
    } finally {
      event.target.value = "";
    }
  };

  reader.readAsText(file);
}

/* =========================================================
   MODAIS
========================================================= */
$("portModal")?.addEventListener("click", function (e) {
  if (e.target.id === "portModal") closeModal();
});

$("editSwitchModal")?.addEventListener("click", function (e) {
  if (e.target.id === "editSwitchModal") closeEditSwitchModal();
});

$("adminModal")?.addEventListener("click", function (e) {
  if (e.target.id === "adminModal") closeAdminModal();
});

$("editUserModal")?.addEventListener("click", function (e) {
  if (e.target.id === "editUserModal") closeEditUserModal();
});

/* =========================================================
   ADMIN
========================================================= */
function isCurrentUserAdmin() {
  return currentUserProfile?.isAdmin === true;
}

function openAdminModal() {
  if (!isCurrentUserAdmin()) {
    alert("Apenas administradores podem acessar os acessos.");
    return;
  }

  clearMessage("adminUserMessage");
  clearMessage("contractMessage");
  renderAdminContractsChecks();
  renderContractsList();
  renderUsersList();

  $("adminModal")?.classList.add("show");
}

window.closeAdminModal = function () {
  $("adminModal")?.classList.remove("show");
  $("adminUserForm")?.reset();
  $("contractForm")?.reset();
  clearMessage("adminUserMessage");
  clearMessage("contractMessage");
};

$("adminBtn")?.addEventListener("click", openAdminModal);

/* =========================================================
   CRUD CONTRATOS
========================================================= */
$("contractForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!isCurrentUserAdmin()) {
    setMessage("contractMessage", "Apenas administradores podem criar contratos.");
    return;
  }

  clearMessage("contractMessage");

  const contractName = $("contractName")?.value.trim() || "";
  const rawContractId = $("contractId")?.value.trim() || "";
  const contractId = normalizeContractId(rawContractId);

  if (!contractName || !contractId) {
    setMessage("contractMessage", "Informe nome e ID do contrato.");
    return;
  }

  try {
    await setDoc(doc(db, "contracts", contractId), {
      name: contractName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    this.reset();
    setMessage("contractMessage", "Contrato cadastrado com sucesso.", false);
  } catch (error) {
    console.error(error);
    setMessage("contractMessage", "Erro ao cadastrar contrato.");
  }
});

window.deleteContract = async function (contractId) {
  if (!isCurrentUserAdmin()) {
    alert("Apenas administradores podem excluir contratos.");
    return;
  }

  const confirmed = confirm(`Deseja excluir o contrato "${getContractName(contractId)}"?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "contracts", contractId));
    alert("Contrato excluído.");
  } catch (error) {
    console.error(error);
    alert("Erro ao excluir contrato. Verifique se não existem dependências.");
  }
};

/* =========================================================
   CRUD USUÁRIOS
========================================================= */
$("adminUserForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!isCurrentUserAdmin()) {
    setMessage("adminUserMessage", "Apenas administradores podem cadastrar usuários.");
    return;
  }

  clearMessage("adminUserMessage");

  const name = $("adminUserName")?.value.trim() || "";
  const email = $("adminUserEmail")?.value.trim() || "";
  const password = $("adminUserPassword")?.value || "";
  const isAdmin = $("adminUserIsAdmin")?.value === "true";
  const mustChangePassword = $("adminMustChangePassword")?.value === "true";
  const selectedContracts = getCheckedValues("adminContractsChecks");

  if (!name || !email || !password) {
    setMessage("adminUserMessage", "Preencha nome, email e senha.");
    return;
  }

  if (password.length < 6) {
    setMessage("adminUserMessage", "A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  if (!selectedContracts.length) {
    setMessage("adminUserMessage", "Selecione ao menos um contrato.");
    return;
  }

  try {
    await fnCreateManagedUser({
      name,
      email,
      password,
      isAdmin,
      contracts: selectedContracts,
      mustChangePassword
    });

    this.reset();
    renderAdminContractsChecks();
    setMessage("adminUserMessage", "Usuário criado com sucesso.", false);
  } catch (error) {
    console.error(error);
    setMessage("adminUserMessage", translateCallableError(error), true);
  }
};

window.openEditUserModal = function (userId) {
  if (!isCurrentUserAdmin()) {
    alert("Apenas administradores podem editar usuários.");
    return;
  }

  const user = users.find(item => item.id === userId);
  if (!user) return;

  editingUserId = userId;

  $("editUserName").value = user.name || "";
  $("editUserEmail").value = user.email || "";
  $("editUserIsAdmin").value = user.isAdmin ? "true" : "false";
  $("editMustChangePassword").value = user.mustChangePassword ? "true" : "false";
  renderEditContractsChecks(Array.isArray(user.contracts) ? user.contracts : []);
  clearMessage("editUserMessage");

  $("editUserModal")?.classList.add("show");
};

window.closeEditUserModal = function () {
  $("editUserModal")?.classList.remove("show");
  $("editUserForm")?.reset();
  clearMessage("editUserMessage");
  editingUserId = null;
};

$("editUserForm")?.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (!editingUserId) {
    setMessage("editUserMessage", "Nenhum usuário selecionado.");
    return;
  }

  const name = $("editUserName")?.value.trim() || "";
  const email = $("editUserEmail")?.value.trim() || "";
  const isAdmin = $("editUserIsAdmin")?.value === "true";
  const mustChangePassword = $("editMustChangePassword")?.value === "true";
  const selectedContracts = getCheckedValues("editContractsChecks");

  if (!name || !email) {
    setMessage("editUserMessage", "Preencha nome e email.");
    return;
  }

  if (!selectedContracts.length) {
    setMessage("editUserMessage", "Selecione ao menos um contrato.");
    return;
  }

  try {
    await fnUpdateManagedUser({
      uid: editingUserId,
      name,
      email,
      isAdmin,
      contracts: selectedContracts,
      mustChangePassword
    });

    setMessage("editUserMessage", "Usuário atualizado com sucesso.", false);
  } catch (error) {
    console.error(error);
    setMessage("editUserMessage", translateCallableError(error), true);
  }
});

$("resetPasswordBtn")?.addEventListener("click", async function () {
  if (!editingUserId) {
    setMessage("editUserMessage", "Nenhum usuário selecionado.");
    return;
  }

  const newPassword = prompt("Digite a nova senha do usuário:");
  if (newPassword === null) return;

  if (String(newPassword).trim().length < 6) {
    setMessage("editUserMessage", "A nova senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  try {
    await fnResetManagedUserPassword({
      uid: editingUserId,
      newPassword: String(newPassword).trim()
    });

    setMessage("editUserMessage", "Senha redefinida com sucesso.", false);
  } catch (error) {
    console.error(error);
    setMessage("editUserMessage", translateCallableError(error), true);
  }
});

window.removeUser = async function (userId) {
  if (!isCurrentUserAdmin()) {
    alert("Apenas administradores podem excluir usuários.");
    return;
  }

  const user = users.find(item => item.id === userId);
  if (!user) return;

  const confirmed = confirm(`Deseja realmente excluir o usuário "${user.name}"?`);
  if (!confirmed) return;

  try {
    await fnDeleteManagedUser({ uid: userId });
    alert("Usuário excluído com sucesso.");
  } catch (error) {
    console.error(error);
    alert(translateCallableError(error));
  }
};

/* =========================================================
   INÍCIO
========================================================= */
renderSwitches();
updateStats();
