import { withApi } from "../_utils/withApi.js";
import { auth } from "../../firebaseAdmin.js";

export const config = {
    runtime: "nodejs"
};

export default withApi("auth", async (req, res) => {
    const action = req.query.action;

    // 🔐 로그인
    if (req.method === "POST" && action === "login") {
        const { idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({ error: "NO_ID_TOKEN" });
        }

        const decoded = await auth.verifyIdToken(idToken);

        const expiresIn = 7 * 24 * 60 * 60 * 1000;
        const sessionCookie = await auth.createSessionCookie(idToken, {
            expiresIn
        });

        res.setHeader(
            "Set-Cookie",
            `session=${sessionCookie}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${expiresIn / 1000}`
        );

        return res.json({ ok: true, uid: decoded.uid });
    }

    // 🔓 로그아웃
    if (req.method === "POST" && action === "logout") {
        res.setHeader(
            "Set-Cookie",
            "session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"
        );
        return res.json({ ok: true });
    }

    // ❌ me는 여기서 처리하지 않음
    return res.status(405).json({ error: "NOT_SUPPORTED" });
});
