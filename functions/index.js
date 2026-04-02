const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

function ensureAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado.");
  }

  return db.collection("users").doc(context.auth.uid).get().then((snap) => {
    if (!snap.exists || snap.data().isAdmin !== true) {
      throw new functions.https.HttpsError("permission-denied", "Apenas administradores podem executar esta ação.");
    }
    return snap.data();
  });
}

exports.createManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const password = String(data.password || "");
    const isAdmin = data.isAdmin === true;
    const mustChangePassword = data.mustChangePassword === true;
    const contracts = Array.isArray(data.contracts) ? data.contracts : [];

    if (!name || !email || !password) {
      throw new functions.https.HttpsError("invalid-argument", "Nome, email e senha são obrigatórios.");
    }

    if (password.length < 6) {
      throw new functions.https.HttpsError("invalid-argument", "A senha deve ter pelo menos 6 caracteres.");
    }

    if (!contracts.length) {
      throw new functions.https.HttpsError("invalid-argument", "Selecione ao menos um contrato.");
    }

    try {
      const userRecord = await admin.auth().createUser({
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
        uid: userRecord.uid
      };
    } catch (error) {
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError("already-exists", "Já existe um usuário com esse email.");
      }
      throw new functions.https.HttpsError("internal", error.message || "Erro ao criar usuário.");
    }
  });

exports.updateManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const uid = String(data.uid || "").trim();
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim().toLowerCase();
    const isAdmin = data.isAdmin === true;
    const mustChangePassword = data.mustChangePassword === true;
    const contracts = Array.isArray(data.contracts) ? data.contracts : [];

    if (!uid || !name || !email) {
      throw new functions.https.HttpsError("invalid-argument", "UID, nome e email são obrigatórios.");
    }

    if (!contracts.length) {
      throw new functions.https.HttpsError("invalid-argument", "Selecione ao menos um contrato.");
    }

    try {
      await admin.auth().updateUser(uid, {
        email,
        displayName: name
      });

      await db.collection("users").doc(uid).set({
        name,
        email,
        isAdmin,
        contracts,
        mustChangePassword,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return { ok: true };
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
      }
      if (error.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError("already-exists", "Já existe um usuário com esse email.");
      }
      throw new functions.https.HttpsError("internal", error.message || "Erro ao atualizar usuário.");
    }
  });

exports.deleteManagedUser = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const uid = String(data.uid || "").trim();

    if (!uid) {
      throw new functions.https.HttpsError("invalid-argument", "UID obrigatório.");
    }

    if (uid === context.auth.uid) {
      throw new functions.https.HttpsError("failed-precondition", "Você não pode excluir seu próprio usuário logado.");
    }

    try {
      await admin.auth().deleteUser(uid);
      await db.collection("users").doc(uid).delete();
      return { ok: true };
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        await db.collection("users").doc(uid).delete();
        return { ok: true };
      }
      throw new functions.https.HttpsError("internal", error.message || "Erro ao excluir usuário.");
    }
  });

exports.resetManagedUserPassword = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {
    await ensureAdmin(context);

    const uid = String(data.uid || "").trim();
    const newPassword = String(data.newPassword || "");

    if (!uid || !newPassword) {
      throw new functions.https.HttpsError("invalid-argument", "UID e nova senha são obrigatórios.");
    }

    if (newPassword.length < 6) {
      throw new functions.https.HttpsError("invalid-argument", "A nova senha deve ter pelo menos 6 caracteres.");
    }

    try {
      await admin.auth().updateUser(uid, {
        password: newPassword
      });

      await db.collection("users").doc(uid).set({
        mustChangePassword: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return { ok: true };
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        throw new functions.https.HttpsError("not-found", "Usuário não encontrado.");
      }
      throw new functions.https.HttpsError("internal", error.message || "Erro ao redefinir senha.");
    }
  });
