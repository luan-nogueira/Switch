const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function normalizeContracts(input) {
  if (!Array.isArray(input)) return [];

  return [...new Set(
    input
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

async function ensureAdmin(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Usuário não autenticado."
    );
  }

  const snap = await db.collection("users").doc(context.auth.uid).get();

  if (!snap.exists) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Seu usuário não possui cadastro no Firestore."
    );
  }

  const data = snap.data() || {};

  if (data.isAdmin !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Apenas administradores podem executar esta ação."
    );
  }

  return {
    uid: context.auth.uid,
    ...data
  };
}

function toHttpsError(error, fallbackMessage) {
  const code = error?.code || "";
  const message = error?.message || fallbackMessage || "Erro interno.";

  if (error instanceof functions.https.HttpsError) {
    throw error;
  }

  if (code === "auth/email-already-exists") {
    throw new functions.https.HttpsError(
      "already-exists",
      "Já existe um usuário com esse email."
    );
  }

  if (code === "auth/user-not-found") {
    throw new functions.https.HttpsError(
      "not-found",
      "Usuário não encontrado."
    );
  }

  if (code === "auth/invalid-email") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Email inválido."
    );
  }

  if (code === "auth/invalid-password") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Senha inválida."
    );
  }

  if (code === "permission-denied") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Você não tem permissão para esta ação."
    );
  }

  console.error("ERRO INTERNO:", error);

  throw new functions.https.HttpsError("internal", message);
}

/* =========================================================
   CREATE MANAGED USER
========================================================= */
exports.createManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const name = String(data?.name || "").trim();
    const email = String(data?.email || "").trim().toLowerCase();
    const password = String(data?.password || "");
    const isAdmin = data?.isAdmin === true;
    const mustChangePassword = data?.mustChangePassword === true;
    const contracts = normalizeContracts(data?.contracts);

    if (!name || !email || !password) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Nome, email e senha são obrigatórios."
      );
    }

    if (password.length < 6) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "A senha deve ter pelo menos 6 caracteres."
      );
    }

    if (!contracts.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Selecione ao menos um contrato."
      );
    }

    let userRecord = null;

    try {
      userRecord = await admin.auth().createUser({
        email,
        password,
        displayName: name
      });

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
      // rollback se criou no Auth mas falhou ao gravar no Firestore
      if (userRecord?.uid) {
        try {
          await admin.auth().deleteUser(userRecord.uid);
        } catch (rollbackError) {
          console.error("Falha no rollback do usuário:", rollbackError);
        }
      }

      toHttpsError(error, "Erro ao criar usuário.");
    }
  });

/* =========================================================
   UPDATE MANAGED USER
========================================================= */
exports.updateManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    const adminUser = await ensureAdmin(context);

    const uid = String(data?.uid || "").trim();
    const name = String(data?.name || "").trim();
    const email = String(data?.email || "").trim().toLowerCase();
    const isAdmin = data?.isAdmin === true;
    const mustChangePassword = data?.mustChangePassword === true;
    const contracts = normalizeContracts(data?.contracts);

    if (!uid || !name || !email) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID, nome e email são obrigatórios."
      );
    }

    if (!contracts.length) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Selecione ao menos um contrato."
      );
    }

    // evita remover o próprio admin de forma acidental
    if (uid === adminUser.uid && isAdmin !== true) {
      throw new functions.https.HttpsError(
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
  });

/* =========================================================
   DELETE MANAGED USER
========================================================= */
exports.deleteManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const uid = String(data?.uid || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID obrigatório."
      );
    }

    if (uid === context.auth.uid) {
      throw new functions.https.HttpsError(
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
  });

/* =========================================================
   RESET MANAGED USER PASSWORD
========================================================= */
exports.resetManagedUserPassword = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const uid = String(data?.uid || "").trim();
    const newPassword = String(data?.newPassword || "").trim();

    if (!uid || !newPassword) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "UID e nova senha são obrigatórios."
      );
    }

    if (newPassword.length < 6) {
      throw new functions.https.HttpsError(
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
  });
