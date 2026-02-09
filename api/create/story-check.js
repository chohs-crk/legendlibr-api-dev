import { withApi } from "../_utils/withApi.js";
import { getSession } from "../base/sessionstore.js";

export const config = { runtime: "nodejs" };

export default withApi("protected", async (req, res, { uid }) => {
    const s = await getSession(uid);
    if (!s) return res.json({ ok: false });

    let flow = null;
    if (s.nowFlow.story1) flow = "story1";
    else if (s.nowFlow.story2) flow = "story2";
    else if (s.nowFlow.story3) flow = "story3";
    else if (s.nowFlow.final) flow = "final";

    const isFinalFF =
        flow === "final" &&
        !s.called &&
        !s.resed;

    return res.json({
        ok: true,
        flow,
        called: s.called || false,
        resed: s.resed || false,
        intro: s.output?.intro || "",
        isFinalFF,
        remain: s.called && !s.resed
            ? Math.max(0, 30000 - (Date.now() - s.lastCall))
            : 0
    });

});