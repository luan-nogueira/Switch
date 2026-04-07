const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/* ======================= HELPERS ======================= */

function normalizeContracts(input) {
  if (!Array.isArray(input)) return [];

  return [...new Set(input.map(i => String(i || "").trim()).filter(Boolean))];
}

async function ensureAdmin(auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError("unauthenticated", "Usuário não autenticado.");
  }

  const snap = await db.collection("users").doc(auth.uid).get();

  if (!snap.exists || snap.data().isAdmin !== true) {
    throw new HttpsError("permission-denied", "Apenas admin.");
  }
}

/* ======================= CREATE (CORRIGIDO) ======================= */

exports.createManagedUser = onRequest(
  { region: "southamerica-east1" },
  async (req, res) => {
    const origin = req.headers.origin || "";

    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      const token = req.headers.authorization?.split("Bearer ")[1];
      const decoded = await admin.auth().verifyIdToken(token);
      await ensureAdmin(decoded);

      const { name, email, password, isAdmin, mustChangePassword, contracts } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ error: "Campos obrigatórios." });
      }

      const user = await admin.auth().createUser({
        email,
        password,
        displayName: name
      });

      await db.collection("users").doc(user.uid).set({
        name,
        email,
        isAdmin: !!isAdmin,
        mustChangePassword: !!mustChangePassword,
        contracts: normalizeContracts(contracts),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({ ok: true });

    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }
);

/* ======================= OUTRAS FUNCTIONS ======================= */

exports.updateManagedUser = onCall({ region: "southamerica-east1" }, async (req) => {
  await ensureAdmin(req.auth);
  return { ok: true };
});

exports.deleteManagedUser = onCall({ region: "southamerica-east1" }, async (req) => {
  await ensureAdmin(req.auth);
  return { ok: true };
});

exports.resetManagedUserPassword = onCall({ region: "southamerica-east1" }, async (req) => {
  await ensureAdmin(req.auth);
  return { ok: true };
});
