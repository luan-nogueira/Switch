import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

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
const db = getFirestore(app);

/* =========================================================
   HELPERS DE ELEMENTOS
========================================================= */
const $ = (id) => document.getElementById(id);

/* =========================================================
   ELEMENTOS
========================================================= */
const authScreen = $("authScreen");
const appContainer = $("appContainer");
const authForm = $("authForm");
const registerBtn = $("registerBtn");
const logoutBtn = $("logoutBtn");
const authMessage = $("authMessage");
const loggedUser = $("loggedUser");

const authEmail = $("authEmail");
const authPassword = $("authPassword");

const contractSelect = $("contractSelect");
const searchInput = $("searchInput");

const switchForm = $("switchForm");
const portForm = $("portForm");
const portModal = $("portModal");

const changePasswordScreen = $("changePasswordScreen");
const changePasswordForm = $("changePasswordForm");
const newPasswordInput = $("newPassword");
const confirmNewPasswordInput = $("confirmNewPassword");
const changePasswordMessage = $("changePasswordMessage");

/* =========================================================
   APP STATE
========================================================= */
let currentUser = null;
let currentUserProfile = null;
let currentContractId = "";
let currentContractNameMap = {};
let switches = [];
let editingSwitchId = null;
let editingPortIndex = null;
let unsubscribeUserProfile = null;
let unsubscribeSwitches = null;
let expandedState = {};

/* =========================================================
   AUTH UI
========================================================= */
function setAuthMessage(message, isError = true) {
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.className = isError ? "auth-message error" : "auth-message success";
}

function clearAuthMessage() {
  if (!authMessage) return;
  authMessage.textContent = "";
  authMessage.className = "auth-message";
}

function setChangePasswordMessage(message, isError = true) {
  if (!changePasswordMessage) return;
  changePasswordMessage.textContent = message;
  changePasswordMessage.className = isError ? "auth-message error" : "auth-message success";
}

function clearChangePasswordMessage() {
  if (!changePasswordMessage) return;
  changePasswordMessage.textContent = "";
  changePasswordMessage.className = "auth-message";
}

function hideAllScreens() {
  if (authScreen) authScreen.classList.add("hidden");
  if (appContainer) appContainer.classList.add("hidden");
  if (changePasswordScreen) changePasswordScreen.classList.add("hidden");
}

function showApp(user) {
  hideAllScreens();
  if (appContainer) appContainer.classList.remove("hidden");
  if (loggedUser) {
    loggedUser.textContent =
      currentUserProfile?.name
        ? `${currentUserProfile.name} (${currentUserProfile.email || user?.email || ""})`
        : (user?.email || "Usuário autenticado");
  }

  renderContractOptions();
  renderSwitches();
  updateStats();
}

function showLogin() {
  hideAllScreens();
  if (authScreen) authScreen.classList.remove("hidden");
}

function showChangePasswordScreen() {
  if (!changePasswordScreen) {
    showApp(currentUser);
    return;
  }

  hideAllScreens();
  changePasswordScreen.classList.remove("hidden");
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
    case "auth/requires-recent-login":
      return "Por segurança, faça login novamente e tente alterar a senha.";
    default:
      return error?.message || "Ocorreu um erro na autenticação.";
  }
}

/* =========================================================
   HELPERS GERAIS
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

function ensureAllowedContract() {
  const contracts = Array.isArray(currentUserProfile?.contracts)
    ? currentUserProfile.contracts
    : [];

  if (!contracts.length) {
    currentContractId = "";
    switches = [];
    renderContractOptions();
    renderSwitches();
    updateStats();
    return false;
  }

  if (!contracts.includes(currentContractId)) {
    currentContractId = contracts[0];
  }

  renderContractOptions();
  return true;
}

/* =========================================================
   FIRESTORE - PERFIL / CONTRATOS
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
  if (!contractSelect) return;

  const contracts = Array.isArray(currentUserProfile?.contracts)
    ? currentUserProfile.contracts
    : [];

  if (!contracts.length) {
    contractSelect.innerHTML = `<option value="">Nenhum contrato liberado</option>`;
    contractSelect.disabled = true;
    return;
  }

  contractSelect.disabled = false;
  contractSelect.innerHTML = contracts.map((contractId) => {
    const name = currentContractNameMap[contractId] || formatContractId(contractId);
    return `<option value="${escapeHtml(contractId)}">${escapeHtml(name)}</option>`;
  }).join("");

  contractSelect.value = currentContractId;
}

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

    const allowedContracts = Array.isArray(currentUserProfile.contracts)
      ? currentUserProfile.contracts
      : [];

    await loadContractNames(allowedContracts);

    if (currentUserProfile.mustChangePassword === true) {
      showChangePasswordScreen();
      return;
    }

    showApp(currentUser);

    const hasAccess = ensureAllowedContract();
    if (!hasAccess) return;

    subscribeSwitches(currentContractId);
  });
}

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
   AUTH EVENTS
========================================================= */
if (authForm) {
  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearAuthMessage();

    const email = authEmail?.value.trim() || "";
    const password = authPassword?.value || "";

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
}

/* 
  Mantive esse botão por compatibilidade com seu HTML atual.
  Mas o ideal é depois remover o cadastro livre e criar usuários só pela área admin.
*/
if (registerBtn) {
  registerBtn.addEventListener("click", async function () {
    clearAuthMessage();

    const email = authEmail?.value.trim() || "";
    const password = authPassword?.value || "";

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
      setAuthMessage("Conta criada com sucesso! Agora crie o documento do usuário no Firestore.", false);
      authForm?.reset();
    } catch (error) {
      setAuthMessage(translateFirebaseError(error), true);
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async function () {
    try {
      await signOut(auth);
    } catch (error) {
      alert("Erro ao sair: " + translateFirebaseError(error));
    }
  });
}

if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearChangePasswordMessage();

    const newPassword = newPasswordInput?.value || "";
    const confirmPassword = confirmNewPasswordInput?.value || "";

    if (!newPassword || !confirmPassword) {
      setChangePasswordMessage("Preencha os dois campos de senha.");
      return;
    }

    if (newPassword.length < 6) {
      setChangePasswordMessage("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setChangePasswordMessage("As senhas não coincidem.");
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

      changePasswordForm.reset();
      setChangePasswordMessage("Senha alterada com sucesso!", false);
      showApp(currentUser);
    } catch (error) {
      setChangePasswordMessage(translateFirebaseError(error), true);
    }
  });
}

onAuthStateChanged(auth, (user) => {
  cleanupListeners();

  currentUser = user || null;
  currentUserProfile = null;
  currentContractId = "";
  currentContractNameMap = {};
  switches = [];
  expandedState = {};

  if (user) {
    subscribeUserProfile(user.uid);
  } else {
    showLogin();
  }
});

/* =========================================================
   CONTRATO
========================================================= */
if (contractSelect) {
  contractSelect.addEventListener("change", function () {
    currentContractId = this.value || "";

    if (!currentContractId) {
      switches = [];
      renderSwitches();
      updateStats();
      return;
    }

    subscribeSwitches(currentContractId);
  });
}

/* =========================================================
   RENDER
========================================================= */
if (searchInput) {
  searchInput.addEventListener("input", renderSwitches);
}

function renderSwitches() {
  const container = $("switchesContainer");
  if (!container) return;

  const search = (searchInput?.value || "").trim().toLowerCase();

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
      sw.obs,
      ...(Array.isArray(sw.ports) ? sw.ports.map(port => `${port.number} ${port.device} ${port.status} ${port.ip} ${port.sector} ${port.obs}`) : [])
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
                Portas: ${sw.portsCount || ports.length || 0} |
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
   AÇÕES
========================================================= */
window.toggleSwitch = function (id) {
  expandedState[id] = !expandedState[id];
  switches = switches.map(sw => sw.id === id ? { ...sw, expanded: expandedState[id] } : sw);
  renderSwitches();
};

window.editSwitch = async function (id) {
  if (!currentContractId) {
    alert("Selecione um contrato.");
    return;
  }

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

  try {
    await updateDoc(doc(db, "contracts", currentContractId, "switches", id), {
      name: newName.trim() || sw.name,
      location: newLocation.trim(),
      model: newModel.trim(),
      obs: newObs.trim(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error(error);
    alert("Erro ao editar switch.");
  }
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

  if ($("modalTitle")) $("modalTitle").textContent = `${sw.name} - Porta ${port.number}`;
  if ($("portDevice")) $("portDevice").value = port.device || "";
  if ($("portStatus")) $("portStatus").value = port.status || "inativo";
  if ($("portIp")) $("portIp").value = port.ip || "";
  if ($("portSector")) $("portSector").value = port.sector || "";
  if ($("portObs")) $("portObs").value = port.obs || "";

  portModal?.classList.add("show");
};

window.closeModal = function () {
  portModal?.classList.remove("show");
  editingSwitchId = null;
  editingPortIndex = null;
  portForm?.reset();
};

window.clearPortData = function () {
  if ($("portDevice")) $("portDevice").value = "";
  if ($("portStatus")) $("portStatus").value = "inativo";
  if ($("portIp")) $("portIp").value = "";
  if ($("portSector")) $("portSector").value = "";
  if ($("portObs")) $("portObs").value = "";
};

/* =========================================================
   FORM SWITCH
========================================================= */
if (switchForm) {
  switchForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!currentContractId) {
      alert("Selecione um contrato.");
      return;
    }

    const name = $("switchName")?.value.trim() || "";
    const location = $("switchLocation")?.value.trim() || "";
    const portsCount = parseInt($("switchPorts")?.value || "24", 10);
    const model = $("switchModel")?.value.trim() || "";
    const obs = $("switchObs")?.value.trim() || "";

    if (!name) {
      alert("Informe o nome do switch.");
      return;
    }

    try {
      await addDoc(collection(db, "contracts", currentContractId, "switches"), {
        localId: generateId(),
        name,
        location,
        portsCount,
        model,
        obs,
        expanded: false,
        ports: createPorts(portsCount),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      this.reset();
      if ($("switchPorts")) $("switchPorts").value = "24";
    } catch (error) {
      console.error(error);
      alert("Erro ao salvar switch.");
    }
  });
}

/* =========================================================
   FORM PORTA
========================================================= */
if (portForm) {
  portForm.addEventListener("submit", async function (e) {
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
}

/* =========================================================
   IMPORT / EXPORT
========================================================= */
window.exportData = function () {
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
};

window.importData = async function (event) {
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
};

/* =========================================================
   MODAL
========================================================= */
if (portModal) {
  portModal.addEventListener("click", function (e) {
    if (e.target.id === "portModal") {
      closeModal();
    }
  });
}

/* =========================================================
   INÍCIO
========================================================= */
renderSwitches();
updateStats();
