import { withApi } from "../_utils/withApi.js";
import { getSession, deleteSession } from "../base/sessionstore.js";

export const config = { runtime: "nodejs" };

export default withApi("protected", async (req, res, { uid }) => {

    try {
        const s = await getSession(uid);

        // 세션 없음
        if (!s || typeof s !== "object") {
            return res.json({ ok: false });
        }

        const nowFlow = s.nowFlow || {};

        let flow = null;
        if (nowFlow?.story1 === true) {
            flow = "story1";
        } else if (nowFlow?.story3 === true) {
            flow = "story3";
        } else if (nowFlow?.final === true) {
            flow = "final";
        }

        const called = !!s.called;
        const resed = !!s.resed;

        const lastCall =
            typeof s.lastCall === "number" && Number.isFinite(s.lastCall)
                ? s.lastCall
                : 0;

        const isFinalFF =
            flow === "final" &&
            called === false &&
            resed === false;

        const remain =
            called && !resed
                ? Math.max(0, 30000 - (Date.now() - lastCall))
                : 0;

        const canRecreateFinal =
            flow === "final" &&
            remain === 0;

        /* ===============================
           🔥 FINAL 타임아웃 자동 정리
        =============================== */
        if (
            flow === "final" &&
            called === true &&
            resed === false &&
            remain === 0
        ) {
            console.warn("[STORY_CHECK][FINAL_TIMEOUT_FORCE_DELETE]", { uid });

            try {
                await deleteSession(uid);
            } catch (e) {
                console.error("[STORY_CHECK][DELETE_FAIL]", e);
            }

            return res.json({
                ok: false,
                forced: true
            });
        }

        return res.json({
            ok: true,
            flow,
            called,
            resed,
            intro: typeof s.output?.intro === "string" ? s.output.intro : "",
            rawName: typeof s.input?.name === "string" ? s.input.name : "",
            isFinalFF,
            remain: Number.isFinite(remain) ? remain : 0,
            canRecreateFinal
        });

    } catch (err) {
        console.error("[STORY_CHECK][UNEXPECTED_ERROR]", err);

        // 절대 500으로 죽지 않게 방어
        return res.json({
            ok: false
        });
    }

});
