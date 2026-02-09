import { withApi } from "../_utils/withApi.js";
import { auth, admin } from "../../firebaseAdmin.js";

const APP_MODE = process.env.APP_MODE || "prod";

// ✅ 여러 이메일 허용
const DEV_ADMIN_EMAILS = [
    "hhchocookierun1@gmail.com",
    "namukkun0011@gmail.com",
    "hhcho92192052@gmail.com"
];


export default withApi("auth", async (req, res) => {
    const action = req.query.action;

    if (req.method === "POST" && action === "login") {
        const { idToken } = req.body || {};
        if (!idToken) {
            return res.status(400).json({ error: "NO_ID_TOKEN" });
        }

        // 1️⃣ 토큰 검증
        const decoded = await auth.verifyIdToken(idToken);
        const email = decoded.email;

        if (!email) {
            return res.status(403).json({ error: "NO_EMAIL" });
        }

        // 2️⃣ 🔥 MODE 기반 허용 분기
        if (APP_MODE === "dev") {
            // DEV: 여러 이메일 중 하나라도 일치하면 허용
            if (!DEV_ADMIN_EMAILS.includes(email)) {
                return res.status(403).json({
                    error: "DEV_ONLY_ADMIN_ALLOWED"
                });
            }
        } else {
            // PROD: 하드코딩 차단 (확장 지점)
            // 👉 나중에 Firestore whitelist 넣을 자리
        }

        // 3️⃣ 세션 발급
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

    if (req.method === "POST" && action === "logout") {
        res.setHeader(
            "Set-Cookie",
            "session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0"
        );
        return res.json({ ok: true });
    }

    return res.status(405).json({ error: "NOT_SUPPORTED" });
});
