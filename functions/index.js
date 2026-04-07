const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/* =========================================================
   HELPERS
========================================================= */
function normalizeContracts(input) {
  if (!Array.isArray(input)) return [];

  return [
    ...new Set(
      input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ];
}

async function ensureAdmin(auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError("unauthenticated", "Usuário não autenticado.");
  }

  const snap = await db.collection("users").doc(auth.uid).get();

  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Seu usuário não possui cadastro no Firestore."
    );
  }

  const data = snap.data() || {};

  if (data.isAdmin !== true) {
    throw new HttpsError(
      "permission-denied",
      "Apenas administradores podem executar esta ação."
    );
  }

  return {
    uid: auth.uid,
    ...data
  };
}

function toHttpsError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  const code = error?.code || "";
  const rawMessage = error?.message || "";
  const message = rawMessage || fallbackMessage || "Erro interno.";

  console.error("ERRO INTERNO DETALHADO:", {
    code,
    message: rawMessage,
    stack: error?.stack,
    fullError: error
  });

  if (code === "auth/email-already-exists") {
    throw new HttpsError("already-exists", "Já existe um usuário com esse email.");
  }

  if (code === "auth/user-not-found") {
    throw new HttpsError("not-found", "Usuário não encontrado.");
  }

  if (code === "auth/invalid-email") {
    throw new HttpsError("invalid-argument", "Email inválido.");
  }

  if (code === "auth/invalid-password") {
    throw new HttpsError("invalid-argument", "Senha inválida.");
  }

  if (code === "auth/operation-not-allowed") {
    throw new HttpsError(
      "failed-precondition",
      "O provedor Email/Senha não está habilitado no Firebase Authentication."
    );
  }

  if (code === "auth/insufficient-permission") {
    throw new HttpsError(
      "permission-denied",
      "A Cloud Function não tem permissão suficiente para criar usuários."
    );
  }

  throw new HttpsError("internal", message || "Erro interno real no servidor.");
}

/* =========================================================
   CREATE USER
========================================================= */
exports.createManagedUser = onCall(
  { region: "southamerica-east1" },
  async (request) => {
    await ensureAdmin(request.auth);

    const data = request.data || {};
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const isAdmin = data.isAdmin === true;
    const mustChangePassword = data.mustChangePassword === true;
    const contracts = normalizeContracts(data.contracts);

    if (!name || !email || !password) {
      throw new HttpsError(
        "invalid-argument",
        "Nome, email e senha são obrigatórios."
      );
    }

    if (password.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "A senha deve ter pelo menos 6 caracteres."
      );
    }

    if (!contracts.length) {
      throw new HttpsError(
        "invalid-argument",
        "Selecione ao menos um contrato."
      );
    }

    let userRecord = null;

    try {
      // Verifica antes se o email já existe no Authentication
      try {
        const existingUser = await admin.auth().getUserByEmail(email);

        if (existingUser) {
          throw new HttpsError(
            "already-exists",
            "Já existe um usuário com esse email."
          );
        }
      } catch (checkError) {
        if (checkError instanceof HttpsError) {
          throw checkError;
        }

        if (checkError?.code !== "auth/user-not-found") {
          throw checkError;
        }
      }

      // Cria no Authentication
      userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name
      });

      // Salva no Firestore
      await db.collection("users").doc(userRecord.uid).set({
        name,
        email,
        isAdmin,
        contracts,
        mustChangePassword,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        ok: true,
        uid: userRecord.uid,
        message: "Usuário criado com sucesso."
      };
    } catch (error) {
      console.error("Falha ao criar usuário:", {
        code: error?.code,
        message: error?.message,
        stack: error?.stack
      });

      // rollback se criou no auth mas falhou depois
      if (userRecord?.uid) {
        try {
          await admin.auth().deleteUser(userRecord.uid);
        } catch (rollbackError) {
          console.error("Falha no rollback do usuário:", rollbackError);
        }
      }

      toHttpsError(error, "Erro ao criar usuário.");
    }
  }
);

/* =========================================================
   UPDATE USER
========================================================= */
exports.updateManagedUser = onCall(
  { region: "southamerica-east1" },
  async (request) => {
    const adminUser = await ensureAdmin(request.auth);
    const data = request.data || {};

    const uid = String(data.uid || "").trim();
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const isAdmin = data.isAdmin === true;
    const mustChangePassword = data.mustChangePassword === true;
    const contracts = normalizeContracts(data.contracts);

    if (!uid || !name || !email) {
      throw new HttpsError(
        "invalid-argument",
        "UID, nome e email são obrigatórios."
      );
    }

    if (!contracts.length) {
      throw new HttpsError(
        "invalid-argument",
        "Selecione ao menos um contrato."
      );
    }

    if (uid === adminUser.uid && isAdmin !== true) {
      throw new HttpsError(
        "failed-precondition",
        "Você não pode remover seu próprio perfil de administrador."
      );
    }

    try {
      await admin.auth().updateUser(uid, {
        email,
        displayName: name
      });

      await db.collection("users").doc(uid).set(
        {
          name,
          email,
          isAdmin,
          contracts,
          mustChangePassword,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return {
        ok: true,
        message: "Usuário atualizado com sucesso."
      };
    } catch (error) {
      toHttpsError(error, "Erro ao atualizar usuário.");
    }
  }
);

/* =========================================================
   DELETE USER
========================================================= */
exports.deleteManagedUser = onCall(
  { region: "southamerica-east1" },
  async (request) => {
    await ensureAdmin(request.auth);
    const data = request.data || {};

    const uid = String(data.uid || "").trim();

    if (!uid) {
      throw new HttpsError("invalid-argument", "UID obrigatório.");
    }

    if (uid === request.auth.uid) {
      throw new HttpsError(
        "failed-precondition",
        "Você não pode excluir seu próprio usuário logado."
      );
    }

    try {
      await admin.auth().deleteUser(uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") {
        toHttpsError(error, "Erro ao excluir usuário no Authentication.");
      }
    }

    try {
      await db.collection("users").doc(uid).delete();
    } catch (error) {
      toHttpsError(error, "Erro ao excluir usuário no Firestore.");
    }

    return {
      ok: true,
      message: "Usuário excluído com sucesso."
    };
  }
);

/* =========================================================
   RESET PASSWORD
========================================================= */
exports.resetManagedUserPassword = onCall(
  { region: "southamerica-east1" },
  async (request) => {
    await ensureAdmin(request.auth);
    const data = request.data || {};

    const uid = String(data.uid || "").trim();
    const newPassword = String(data.newPassword || "").trim();

    if (!uid || !newPassword) {
      throw new HttpsError(
        "invalid-argument",
        "UID e nova senha são obrigatórios."
      );
    }

    if (newPassword.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "A nova senha deve ter pelo menos 6 caracteres."
      );
    }

    try {
      await admin.auth().updateUser(uid, {
        password: newPassword
      });

      await db.collection("users").doc(uid).set(
        {
          mustChangePassword: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return {
        ok: true,
        message: "Senha redefinida com sucesso."
      };
    } catch (error) {
      toHttpsError(error, "Erro ao redefinir senha.");
    }
  }
);
