const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
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
      "A Cloud Function não tem permissão suficiente para executar esta ação."
    );
  }

  throw new HttpsError("internal", message || "Erro interno real no servidor.");
}

/* =========================================================
   CREATE USER
========================================================= */
exports.createManagedUser = onRequest(
  {
    region: "southamerica-east1"
  },
  async (req, res) => {
    const allowedOrigins = [
      "https://luan-nogueira.github.io",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ];

    const origin = req.headers.origin || "";

    if (allowedOrigins.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
    }

    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Método não permitido."
      });
    }

    try {
      const authHeader = req.headers.authorization || "";

      if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          ok: false,
          error: "Token de autenticação não enviado."
        });
      }

      const idToken = authHeader.split("Bearer ")[1]?.trim();

      if (!idToken) {
        return res.status(401).json({
          ok: false,
          error: "Token de autenticação inválido."
        });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      await ensureAdmin(decodedToken);

      const data = req.body || {};
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      const isAdmin = data.isAdmin === true;
      const mustChangePassword = data.mustChangePassword === true;
      const contracts = normalizeContracts(data.contracts);

      if (!name || !email || !password) {
        return res.status(400).json({
          ok: false,
          error: "Nome, email e senha são obrigatórios."
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          ok: false,
          error: "A senha deve ter pelo menos 6 caracteres."
        });
      }

      if (!contracts.length) {
        return res.status(400).json({
          ok: false,
          error: "Selecione ao menos um contrato."
        });
      }

      let userRecord = null;

      try {
        try {
          const existingUser = await admin.auth().getUserByEmail(email);

          if (existingUser) {
            return res.status(409).json({
              ok: false,
              error: "Já existe um usuário com esse email."
            });
          }
        } catch (checkError) {
          if (checkError?.code !== "auth/user-not-found") {
            throw checkError;
          }
        }

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

        return res.status(200).json({
          ok: true,
          uid: userRecord.uid,
          message: "Usuário criado com sucesso."
        });
      } catch (error) {
        console.error("Falha ao criar usuário:", {
          code: error?.code,
          message: error?.message,
          stack: error?.stack
        });

        if (userRecord?.uid) {
          try {
            await admin.auth().deleteUser(userRecord.uid);
          } catch (rollbackError) {
            console.error("Falha no rollback do usuário:", rollbackError);
          }
        }

        if (error?.code === "auth/email-already-exists") {
          return res.status(409).json({
            ok: false,
            error: "Já existe um usuário com esse email."
          });
        }

        if (error?.code === "auth/invalid-email") {
          return res.status(400).json({
            ok: false,
            error: "Email inválido."
          });
        }

        if (error?.code === "auth/invalid-password") {
          return res.status(400).json({
            ok: false,
            error: "Senha inválida."
          });
        }

        return res.status(500).json({
          ok: false,
          error: error?.message || "Erro ao criar usuário."
        });
      }
    } catch (error) {
      console.error("Erro geral createManagedUser:", error);

      if (error instanceof HttpsError) {
        const statusMap = {
          unauthenticated: 401,
          "permission-denied": 403,
          "invalid-argument": 400,
          "already-exists": 409,
          "failed-precondition": 400,
          "not-found": 404
        };

        return res.status(statusMap[error.code] || 500).json({
          ok: false,
          error: error.message || "Erro na requisição."
        });
      }

      return res.status(500).json({
        ok: false,
        error: error?.message || "Erro interno no servidor."
      });
    }
  }
);
/* =========================================================
   UPDATE USER
========================================================= */
exports.updateManagedUser = onCall(
  {
    region: "southamerica-east1",
    cors: true
  },
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
  {
    region: "southamerica-east1",
    cors: true
  },
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
  {
    region: "southamerica-east1",
    cors: true
  },
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
