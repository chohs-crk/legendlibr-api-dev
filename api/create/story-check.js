import { withApi } from "../_utils/withApi.js";
import { getSession, deleteSession } from "../base/sessionstore.js";
import { db } from "../../firebaseAdmin.js";

export const config = { runtime: "nodejs" };

export default withApi("protected", async (req, res, { uid }) => {
    try {
        const rawName =
            typeof req.query?.rawName === "string"
                ? req.query.rawName.trim()
                : "";

        const s = await getSession(uid);

        /* ===============================
           세션 없음
           - rawName이 있으면 "완료된 캐릭터" 조회 시도
        =============================== */
        if (!s || typeof s !== "object") {
            if (rawName) {
                const snap = await db
                    .collection("characters")
                    .where("uid", "==", uid)
                    .where("displayRawName", "==", rawName)
                    .orderBy("createdAt", "desc")
                    .limit(1)
                    .get();

                if (!snap.empty) {
                    return res.json({
                        ok: true,
                        done: true,
                        charId: snap.docs[0].id,
                        rawName
                    });
                }
            }

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
           FINAL 타임아웃 자동 정리
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

        /* ===============================
           세션은 final이 아니지만, rawName으로 완성 캐릭터 조회가 필요한 경우
        =============================== */
        if (flow !== "final" && rawName) {
            const snap = await db
                .collection("characters")
                .where("uid", "==", uid)
                .where("displayRawName", "==", rawName)
                .orderBy("createdAt", "desc")
                .limit(1)
                .get();

            if (!snap.empty) {
                return res.json({
                    ok: true,
                    done: true,
                    charId: snap.docs[0].id,
                    rawName
                });
            }
        }

        return res.json({
            ok: true,
            flow,
            called,
            resed,
            intro: typeof s.output?.intro === "string" ? s.output.intro : "",
            rawName:
                typeof s.input?.name === "string"
                    ? s.input.name
                    : rawName,
            isFinalFF,
            remain: Number.isFinite(remain) ? remain : 0,
            canRecreateFinal
        });

    } catch (err) {
        console.error("[STORY_CHECK][UNEXPECTED_ERROR]", err);

        return res.json({
            ok: false
        });
    }
});