export const config = {
    runtime: "nodejs",
    compute: 1
};


import { withApi } from "../_utils/withApi.js";
import { db } from "../../firebaseAdmin.js";
import { ORIGINS } from "../base/data/origins.js";
import { getSession, setSession, deleteSession } from "../base/sessionstore.js";

import { callAI } from "./promptinit-ai.js";
import { applyUserMetaDelta } from "./_internal/user-meta-update.js";






export default withApi("expensive", async (req, res, { uid }) => {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "POST_ONLY" });
    }


    // === 0. 기존 세션 존재 여부 확인 ===
    const existing = await getSession(uid);

    if (existing) {
        const isFinal =
            existing.nowFlow?.final === true;

        // 🔒 final 단계면 거부
        if (isFinal) {
            return res.status(409).json({
                ok: false,
                error: "FINAL_IN_PROGRESS"
            });
        }

        // 🔓 final이 아니면 기존 세션 강제 삭제 후 새로 생성 허용
        await deleteSession(uid);
    }

    // ===============================
    // 🔒 charCount 제한 (10)
    // ===============================
    const userSnap = await db.collection("users").doc(uid).get();
    const charCount = userSnap.exists ? userSnap.data().charCount || 0 : 0;

    if (charCount >= 10) {
        return res.status(403).json({
            ok: false,
            error: "CHARACTER_LIMIT_REACHED"
        });
    }


    // === 1. 입력값 파싱 ===
    const { originId, regionId, displayNameRaw: name, prompt } = req.body;
    console.log("[prompt-init] parsed:", { originId, regionId, name, prompt });



    // === 2. origin 검증 ===
    const originData = ORIGINS[originId];  // <-- 수정: originData 정의
    if (!originData) {
        return res.status(400).json({ ok: false, error: "INVALID_ORIGIN" });
    }

    // === 3. region 처리 ===

    // 🔥 default region 판별 기준 (_DEFAULT 접미사)
    const isDefaultRegion = regionId.endsWith("_DEFAULT");

    let regionData;

    if (isDefaultRegion) {
        // --- default region ---
        const defaultSnap = await db
            .collection("regionsDefault")
            .doc(regionId)
            .get();

        if (!defaultSnap.exists) {
            return res.status(400).json({
                ok: false,
                error: "INVALID_DEFAULT_REGION"
            });
        }

        regionData = defaultSnap.data();
    } else {
        // --- user region ---
        const regionSnap = await db
            .collection("regionsUsers")
            .doc(regionId)
            .get();

        if (!regionSnap.exists) {
            return res.status(400).json({
                ok: false,
                error: "INVALID_REGION"
            });
        }

        regionData = regionSnap.data();

        // === 유저 보유 검증 (user region만) ===
        const myRegionSnap = await db
            .collection("users")
            .doc(uid)
            .collection("myregion")
            .doc(regionId)
            .get();

        if (!myRegionSnap.exists) {
            return res.status(403).json({
                ok: false,
                error: "REGION_NOT_OWNED"
            });
        }
    }




    // === 4. region과 origin 일관성 검증 ===
    if (regionData.originId !== originId) {
        return res.status(400).json({ ok: false, error: "MISMATCH_REGION" });
    }

    // ===============================
    // 🔥 두루마리 5개 차감 (AI 호출 전)
    // ===============================
    let userMeta;
    try {
        userMeta = await applyUserMetaDelta(uid, {
            scrollDelta: -5
        });
    } catch (err) {
        if (err.code === "INSUFFICIENT_SCROLL") {
            return res.status(403).json({
                ok: false,
                error: "INSUFFICIENT_SCROLL"
            });
        }

        console.error("[prompt-init] scroll deduction error:", err);
        return res.status(500).json({
            ok: false,
            error: "SCROLL_DEDUCTION_FAILED"
        });
    }

    // === 6. 세션 생성 (세션 없을 때만) ===
    await setSession(uid, {
        nowFlow: {
            refine: true,
            story1: false,
          
            story3: false,
            final: false
        },
        called: false,
        resed: false,
        lastCall: 0,
        input: {
            origin: originData,
            region: { ...regionData, id: regionId },
            name,
            prompt
        },
        output: {}
    });



    console.log("[prompt-init] session created:", uid);

    // === 7. AI 호출을 이 요청 안에서 직접 수행 ===
    try {
        console.log("[prompt-init] calling callAI(uid):", uid);
        try {
            await callAI(uid);

            return res.status(200).json({
                ok: true,
                flow: "refine",
                userMeta   // 🔥 추가
            });


        } catch (err) {
            console.error("[prompt-init][REFINE BLOCKED]", err.message);

            return res.status(400).json({
                ok: false,
                error: err.message || "REFINE_BLOCKED"
            });
        }


    } catch (err) {
        console.error("[prompt-init] callAI ERROR:", err);
        return res.status(500).json({
            ok: false,
            error: "AI_CALL_FAILED"
        });
    }

    // ⬆ 이제 setImmediate(...) 쪽은 완전히 삭제



});
