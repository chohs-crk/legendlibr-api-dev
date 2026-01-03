export const config = { runtime: "nodejs" };

import { withApi } from "../_utils/withApi.js";
import { getSession } from "../base/sessionstore.js";


const TIMEOUT = 30000;



export default withApi("protected", async (req, res, { uid }) => {
    const s = await getSession(uid);
    if (!s) {
        return res.json({ ok: false, error: "NO_SESSION_FLOW" });
    }


    // story1 완료되었으면 즉시 반환
    if (s.nowFlow?.story1 === true) {
        return res.json({ ok: true, nowFlow: s.nowFlow });
    }

    // long poll
    const start = Date.now();

    const interval = setInterval(async () => {
        const now = Date.now();

        const cur = await getSession(uid);

        if (!cur) {
            clearInterval(interval);
            return res.json({ ok: false, error: "NO_SESSION_FLOW" });
        }

        if (cur.nowFlow?.story1 === true) {
            clearInterval(interval);
            return res.json({ ok: true, nowFlow: cur.nowFlow });
        }

        if (now - start >= TIMEOUT) {
            clearInterval(interval);
            return res.json({ ok: false, timeout: true });
        }

    }, 1000);
});

